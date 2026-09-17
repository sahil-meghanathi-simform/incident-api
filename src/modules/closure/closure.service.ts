import { withTransaction } from '../../db/transaction';
import { assertTransition } from '../../policy/stage.policy';
import { hasClosureRequirements } from '../../policy/closure.policy';
import type { ProposeClosureRequest } from '../../contracts/closure.contract';
import type { IncidentDetail, IncidentListResponse } from '../../contracts/incident.contract';
import {
  ClosureRequirementsMissingError,
  InvalidStageTransitionError,
  NotAssignedInvestigatorError,
  StaleVersionError,
} from '../../core/errors/domain-errors';
import type { Actor } from '../../types/actor.type';
import * as auditService from '../audit/audit.service';
import { getById, getByIdForActor } from '../incidents/incident.service';
import { toIncidentListItem } from '../incidents/incident.mapper';
import { findClosuresPendingPage, updateVersioned, type UpdateIncidentStateInput } from '../incidents/incident.repository';
import { buildOffsetPage } from '../../core/pagination';

/**
 * Same 403-vs-404 disambiguation reload as every other Module 4/5 mutation (§2.3) — a
 * self-inflicted access change on write (there isn't one here, but the pattern is kept
 * consistent) must never surface as a 404.
 */
function reloadDetail(actor: Actor, id: string): Promise<IncidentDetail> {
  return getById(actor, id);
}

/**
 * "assignee, ADMIN" (implementation-plan.md §11.1) is a per-incident decision, not a
 * static role list — a TRIAGE_MANAGER is never anyone's assignedInvestigatorId, so this
 * falls through to the same 403 NOT_ASSIGNED_INVESTIGATOR the notes module already uses
 * for "visible but not yours" (§10.1's precedent, reused rather than duplicated here).
 */
function assertIsAssigneeOrAdmin(actor: Actor, incident: { assignedInvestigatorId: string | null }, incidentId: string): void {
  if (actor.role === 'ADMIN' || incident.assignedInvestigatorId === actor.id) return;
  throw new NotAssignedInvestigatorError(incidentId);
}

/**
 * Gate 1 (build-plan.md §2.4) lives entirely in ProposeClosureRequestSchema — a blank
 * or whitespace-only rootCause/correctiveAction never reaches this function. This is
 * `INVESTIGATION -> PENDING_CLOSURE` only: assertTransition also rejects a repeat
 * proposal on an already-PENDING_CLOSURE incident and any attempt from TRIAGE/CLOSED.
 */
export async function propose(
  actor: Actor,
  id: string,
  input: ProposeClosureRequest,
  expectedVersion: number,
): Promise<IncidentDetail> {
  const incident = await getByIdForActor(actor, id);
  assertIsAssigneeOrAdmin(actor, incident, id);
  assertTransition(incident.stage, 'PENDING_CLOSURE');

  const now = new Date();
  const data: UpdateIncidentStateInput = {
    stage: 'PENDING_CLOSURE',
    rootCause: input.rootCause,
    correctiveAction: input.correctiveAction,
    closureProposedById: actor.id,
    closureProposedAt: now,
  };

  await withTransaction(async (tx) => {
    const count = await updateVersioned(tx, id, expectedVersion, data);
    if (count !== 1) throw new StaleVersionError(expectedVersion);

    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'CLOSURE_PROPOSED',
      payload: { rootCauseLength: input.rootCause.length, correctiveActionLength: input.correctiveAction.length },
      occurredAt: now,
    });
    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'STAGE_CHANGED',
      fromValue: incident.stage,
      toValue: 'PENDING_CLOSURE',
      occurredAt: now,
    });
  });

  return reloadDetail(actor, id);
}

/**
 * Gate 3 (§2.4): `incident.rootCause`/`incident.correctiveAction` here come from
 * getByIdForActor's own fresh, scoped DB read — NOT from the request body, which
 * ApproveClosureRequestSchema (gate 2) allows no RCA keys into in the first place.
 * Gate 4 is the `closed_requires_rca` CHECK constraint, an independent backstop even
 * against a raw SQL UPDATE. assertTransition alone already refuses an approve attempt
 * on anything other than PENDING_CLOSURE (409 INVALID_STAGE_TRANSITION) — including a
 * repeat approval on an already-CLOSED incident, since CLOSED has no outgoing
 * transitions.
 */
export async function approve(actor: Actor, id: string, expectedVersion: number): Promise<IncidentDetail> {
  const incident = await getByIdForActor(actor, id);
  assertTransition(incident.stage, 'CLOSED');
  if (!hasClosureRequirements(incident)) throw new ClosureRequirementsMissingError();

  const now = new Date();
  await withTransaction(async (tx) => {
    const count = await updateVersioned(tx, id, expectedVersion, {
      stage: 'CLOSED',
      closedById: actor.id,
      closedAt: now,
    });
    if (count !== 1) throw new StaleVersionError(expectedVersion);

    await auditService.record(tx, { incidentId: id, actorId: actor.id, type: 'CLOSURE_APPROVED', occurredAt: now });
    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'STAGE_CHANGED',
      fromValue: incident.stage,
      toValue: 'CLOSED',
      occurredAt: now,
    });
  });

  return reloadDetail(actor, id);
}

/**
 * Back to INVESTIGATION with the RCA text RETAINED (build-plan.md §Module 6) — the
 * investigator edits the existing draft rather than retyping it from nothing.
 *
 * Deliberately NOT `assertTransition(incident.stage, 'INVESTIGATION')`: the stage map
 * has TWO sources that reach INVESTIGATION (TRIAGE, via assignment, and
 * PENDING_CLOSURE, via this rejection), so a generic to-stage check would wrongly let
 * a TRIAGE-stage incident through this endpoint. Rejection is only ever valid FROM
 * PENDING_CLOSURE, so that source stage is checked explicitly instead — the same
 * discipline triage.service.ts::unassignInvestigator already uses for this identical
 * ambiguity.
 */
export async function reject(actor: Actor, id: string, reason: string, expectedVersion: number): Promise<IncidentDetail> {
  const incident = await getByIdForActor(actor, id);
  if (incident.stage !== 'PENDING_CLOSURE') {
    throw new InvalidStageTransitionError(incident.stage, 'INVESTIGATION', 'closure can only be rejected while pending review');
  }

  const now = new Date();
  await withTransaction(async (tx) => {
    const count = await updateVersioned(tx, id, expectedVersion, { stage: 'INVESTIGATION' });
    if (count !== 1) throw new StaleVersionError(expectedVersion);

    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'CLOSURE_REJECTED',
      reason,
      occurredAt: now,
    });
    await auditService.record(tx, {
      incidentId: id,
      actorId: actor.id,
      type: 'STAGE_CHANGED',
      fromValue: incident.stage,
      toValue: 'INVESTIGATION',
      reason,
      occurredAt: now,
    });
  });

  return reloadDetail(actor, id);
}

export async function getClosuresPending(actor: Actor, page: number, pageSize: number): Promise<IncidentListResponse> {
  const { items, totalItems } = await findClosuresPendingPage(actor, page, pageSize);
  return buildOffsetPage(items.map(toIncidentListItem), totalItems, page, pageSize);
}
