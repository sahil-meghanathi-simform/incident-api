import type { Stage } from '@prisma/client';
import { HIGH_BAND_RANK, SEVERITY_RANK } from '../../config/constants';
import { withTransaction } from '../../db/transaction';
import { assertTransition } from '../../policy/stage.policy';
import { canAssignInvestigator, mustUnassignOnRaise } from '../../policy/assignment.policy';
import type { Severity } from '../../contracts/enums';
import type { ChangeSeverityRequest } from '../../contracts/triage.contract';
import type { IncidentDetail, IncidentListResponse } from '../../contracts/incident.contract';
import {
  AlreadyAcknowledgedError,
  IncidentClosedError,
  InvalidAssignmentTargetError,
  InvalidStageTransitionError,
  InvestigatorClearanceTooLowError,
  NoInvestigatorAssignedError,
  SeverityUnchangedError,
  StaleVersionError,
} from '../../core/errors/domain-errors';
import { NotFoundError } from '../../core/errors/http-errors';
import type { Actor } from '../../types/actor.type';
import * as auditService from '../audit/audit.service';
import { getById, getByIdForActor } from '../incidents/incident.service';
import { toIncidentListItem } from '../incidents/incident.mapper';
import { findTriageQueuePage, updateVersioned, type UpdateIncidentStateInput } from '../incidents/incident.repository';
import { findInvestigatorById } from '../users/users.repository';
import { buildOffsetPage } from '../../core/pagination';

interface SeverityClockFields {
  highSeveritySince: Date | null;
  escalationCycle: number;
  currentEscalationLevel: number;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
}

/**
 * build-plan.md finding S1: the reference plan's §9.1 enumerates three cases — entering
 * the band, moving up within it, leaving it — and omits the fourth, lowering WITHIN the
 * band (CRITICAL → HIGH, which Q14 explicitly permits). Both "obvious" completions are
 * defects: nulling highSeveritySince while still HIGH violates the high_severity_clock
 * CHECK (500 on a routine triage action); falling through unchanged leaves
 * currentEscalationLevel at the CRITICAL cycle's value, so the HIGH tier set can never
 * fire again — §3.4 failing silently. This is a single TOTAL function over band
 * membership so there is no fourth case left implicit.
 */
export function applySeverityChange(current: Severity, next: Severity, now: Date, state: SeverityClockFields): SeverityClockFields {
  const wasHighBand = SEVERITY_RANK[current] >= HIGH_BAND_RANK;
  const isHighBand = SEVERITY_RANK[next] >= HIGH_BAND_RANK;

  if (isHighBand && (!wasHighBand || SEVERITY_RANK[next] > SEVERITY_RANK[current])) {
    // Entering the band, or raising within it: a fresh escalation cycle demands fresh
    // acknowledgement — Q21's (incidentId, cycle, level) uniqueness key includes `cycle`
    // precisely so this new cycle can escalate again from level 0.
    return {
      highSeveritySince: now,
      escalationCycle: state.escalationCycle + 1,
      currentEscalationLevel: 0,
      acknowledgedAt: null,
      acknowledgedById: null,
    };
  }

  if (!isHighBand) {
    // Leaving the band entirely.
    return {
      highSeveritySince: null,
      escalationCycle: state.escalationCycle,
      currentEscalationLevel: 0,
      acknowledgedAt: state.acknowledgedAt,
      acknowledgedById: state.acknowledgedById,
    };
  }

  // Lowering WITHIN the band (CRITICAL → HIGH): keep the clock, the cycle, the level and
  // any acknowledgement exactly as they were (Q19's clock origin is untouched), so the
  // lower tier set does not re-notify humans about levels already raised.
  return {
    highSeveritySince: state.highSeveritySince,
    escalationCycle: state.escalationCycle,
    currentEscalationLevel: state.currentEscalationLevel,
    acknowledgedAt: state.acknowledgedAt,
    acknowledgedById: state.acknowledgedById,
  };
}

/**
 * Reloads through the SAME two-query 403-vs-404 disambiguation as every other read
 * path (§2.3), not a naive null-check. A self-inflicted severity raise (Module 4's own
 * mutations can move an incident out of the acting actor's own clearance) means the
 * post-write read-back can legitimately fail with "exists but you can no longer see
 * it" — that must surface as 403 INSUFFICIENT_CLEARANCE, not 404, or a successful
 * write gets reported to the client as if the incident vanished.
 */
function reloadDetail(actor: Actor, id: string): Promise<IncidentDetail> {
  return getById(actor, id);
}

/**
 * §9.1: `REPORTED → TRIAGE`. assertTransition also does the job of rejecting a
 * `CLOSED` (or any other non-REPORTED) incident here, since CLOSED has no outgoing
 * transitions and TRIAGE is only reachable from REPORTED.
 */
export async function triage(actor: Actor, id: string, expectedVersion: number): Promise<IncidentDetail> {
  const incident = await getByIdForActor(actor, id);
  assertTransition(incident.stage, 'TRIAGE');

  const now = new Date();
  await withTransaction(async (tx) => {
    const count = await updateVersioned(tx, id, expectedVersion, { stage: 'TRIAGE' });
    if (count !== 1) throw new StaleVersionError(expectedVersion);
    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'STAGE_CHANGED',
      fromValue: incident.stage,
      toValue: 'TRIAGE',
      occurredAt: now,
    });
  });

  return reloadDetail(actor, id);
}

/**
 * Loads through getByIdForActor (a triager cannot change the severity of an incident
 * they cannot see), refuses no-ops, applies the total applySeverityChange() helper
 * above, then the Q17 cascade: if the assignee's clearance no longer covers the new
 * severity, auto-unassign and — if that stranded assignment was mid-investigation —
 * return the incident to TRIAGE.
 */
export async function changeSeverity(
  actor: Actor,
  id: string,
  input: ChangeSeverityRequest,
  expectedVersion: number,
): Promise<IncidentDetail> {
  const incident = await getByIdForActor(actor, id);
  if (incident.stage === 'CLOSED') throw new IncidentClosedError();
  if (incident.severity === input.severity) throw new SeverityUnchangedError();

  const now = new Date();
  const clock = applySeverityChange(incident.severity, input.severity, now, incident);
  const data: UpdateIncidentStateInput = { severity: input.severity, ...clock };

  let unassignedInvestigatorId: string | null = null;
  let stageChangedTo: Stage | undefined;
  if (incident.assignee && mustUnassignOnRaise(incident.assignee.clearanceLevel, input.severity)) {
    data.assignedInvestigatorId = null;
    unassignedInvestigatorId = incident.assignee.id;
    if (incident.stage === 'INVESTIGATION') {
      data.stage = 'TRIAGE';
      stageChangedTo = 'TRIAGE';
    }
  }

  await withTransaction(async (tx) => {
    const count = await updateVersioned(tx, id, expectedVersion, data);
    if (count !== 1) throw new StaleVersionError(expectedVersion);

    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'SEVERITY_CHANGED',
      fromValue: incident.severity,
      toValue: input.severity,
      reason: input.reason,
      occurredAt: now,
    });

    if (unassignedInvestigatorId) {
      await auditService.record(tx, {
        incidentId: id,
        actorId: actor.id,
        type: 'INVESTIGATOR_UNASSIGNED',
        fromValue: unassignedInvestigatorId,
        reason: 'CLEARANCE_BELOW_NEW_SEVERITY',
        occurredAt: now,
      });
    }

    if (stageChangedTo) {
      await auditService.record(tx, {
        incidentId: id,
        actorId: actor.id,
        type: 'STAGE_CHANGED',
        fromValue: incident.stage,
        toValue: stageChangedTo,
        reason: 'CLEARANCE_BELOW_NEW_SEVERITY',
        occurredAt: now,
      });
    }
  });

  return reloadDetail(actor, id);
}

/**
 * Reassignment writes both INVESTIGATOR_UNASSIGNED (old) and INVESTIGATOR_ASSIGNED
 * (new); assigning out of TRIAGE also advances the stage to INVESTIGATION.
 */
export async function assignInvestigator(
  actor: Actor,
  id: string,
  investigatorId: string,
  expectedVersion: number,
): Promise<IncidentDetail> {
  const incident = await getByIdForActor(actor, id);
  if (incident.stage === 'CLOSED') throw new IncidentClosedError();

  const investigator = await findInvestigatorById(investigatorId);
  if (!investigator) throw new NotFoundError('Investigator', investigatorId);
  if (investigator.role !== 'INVESTIGATOR' || !investigator.isActive) throw new InvalidAssignmentTargetError();

  if (!canAssignInvestigator(investigator.clearanceLevel, incident.severity)) {
    throw new InvestigatorClearanceTooLowError(SEVERITY_RANK[incident.severity], investigator.clearanceLevel);
  }

  const now = new Date();
  const data: UpdateIncidentStateInput = { assignedInvestigatorId: investigator.id };
  let stageChangedTo: Stage | undefined;
  if (incident.stage === 'TRIAGE') {
    data.stage = 'INVESTIGATION';
    stageChangedTo = 'INVESTIGATION';
  }

  const previousAssigneeId = incident.assignee?.id;

  await withTransaction(async (tx) => {
    const count = await updateVersioned(tx, id, expectedVersion, data);
    if (count !== 1) throw new StaleVersionError(expectedVersion);

    if (previousAssigneeId && previousAssigneeId !== investigator.id) {
      await auditService.record(tx, {
        incidentId: id,
        actorId: actor.id,
        type: 'INVESTIGATOR_UNASSIGNED',
        fromValue: previousAssigneeId,
        reason: 'REASSIGNED',
        occurredAt: now,
      });
    }

    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'INVESTIGATOR_ASSIGNED',
      toValue: investigator.id,
      occurredAt: now,
    });

    if (stageChangedTo) {
      await auditService.record(tx, {
        incidentId: id,
        actorId: actor.id,
        type: 'STAGE_CHANGED',
        fromValue: incident.stage,
        toValue: stageChangedTo,
        occurredAt: now,
      });
    }
  });

  return reloadDetail(actor, id);
}

/**
 * §9.1: "unassign, returns to TRIAGE". A PENDING_CLOSURE/CLOSED incident refuses this
 * outright rather than silently violating the stage map — PENDING_CLOSURE has no
 * transition back to TRIAGE (only CLOSED or INVESTIGATION via approve/reject).
 */
export async function unassignInvestigator(actor: Actor, id: string, expectedVersion: number): Promise<IncidentDetail> {
  const incident = await getByIdForActor(actor, id);
  if (incident.stage === 'CLOSED') throw new IncidentClosedError();
  if (!incident.assignedInvestigatorId) throw new NoInvestigatorAssignedError();
  if (incident.stage === 'PENDING_CLOSURE') {
    throw new InvalidStageTransitionError(incident.stage, 'TRIAGE', 'cannot unassign while a closure is pending review');
  }

  const now = new Date();
  const data: UpdateIncidentStateInput = { assignedInvestigatorId: null };
  let stageChangedTo: Stage | undefined;
  if (incident.stage === 'INVESTIGATION') {
    data.stage = 'TRIAGE';
    stageChangedTo = 'TRIAGE';
  }

  const removedAssigneeId = incident.assignedInvestigatorId;

  await withTransaction(async (tx) => {
    const count = await updateVersioned(tx, id, expectedVersion, data);
    if (count !== 1) throw new StaleVersionError(expectedVersion);

    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'INVESTIGATOR_UNASSIGNED',
      fromValue: removedAssigneeId,
      reason: 'MANUAL',
      occurredAt: now,
    });

    if (stageChangedTo) {
      await auditService.record(tx, {
        incidentId: id,
        actorId: actor.id,
        type: 'STAGE_CHANGED',
        fromValue: incident.stage,
        toValue: stageChangedTo,
        occurredAt: now,
      });
    }
  });

  return reloadDetail(actor, id);
}

/**
 * Q18: stops the escalation clock for the current cycle. Does NOT delete existing
 * EscalationEvent rows — the history that it *was* escalated is permanent; this only
 * stops the job (which filters on `acknowledgedAt IS NULL`) from escalating further.
 */
export async function acknowledge(actor: Actor, id: string, expectedVersion: number): Promise<IncidentDetail> {
  const incident = await getByIdForActor(actor, id);
  if (incident.stage === 'CLOSED') throw new IncidentClosedError();
  if (incident.acknowledgedAt) throw new AlreadyAcknowledgedError();

  const now = new Date();
  await withTransaction(async (tx) => {
    const count = await updateVersioned(tx, id, expectedVersion, {
      acknowledgedAt: now,
      acknowledgedById: actor.id,
    });
    if (count !== 1) throw new StaleVersionError(expectedVersion);
    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'INCIDENT_ACKNOWLEDGED',
      occurredAt: now,
    });
  });

  return reloadDetail(actor, id);
}

export async function getTriageQueue(actor: Actor, page: number, pageSize: number): Promise<IncidentListResponse> {
  const { items, totalItems } = await findTriageQueuePage(actor, page, pageSize);
  return buildOffsetPage(items.map(toIncidentListItem), totalItems, page, pageSize);
}
