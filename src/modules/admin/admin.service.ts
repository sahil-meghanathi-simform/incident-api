import type { Role } from '@prisma/client';
import { withTransaction } from '../../db/transaction';
import { mustUnassignOnRaise } from '../../policy/assignment.policy';
import type {
  AdminJobRunsResponse,
  AdminUserMutationResponse,
  AdminUsersQuery,
  AdminUsersResponse,
  ClearanceImpactResponse,
  TierSetRequest,
} from '../../contracts/admin.contract';
import type { EscalationTiersResponse } from '../../contracts/escalation.contract';
import { LastAdminError, SelfModificationForbiddenError, StaleVersionError } from '../../core/errors/domain-errors';
import { NotFoundError } from '../../core/errors/http-errors';
import { buildOffsetPage } from '../../core/pagination';
import type { Actor } from '../../types/actor.type';
import { jobRunRepository } from '../../jobs/jobRun.repository';
import * as auditService from '../audit/audit.service';
import {
  findAssignedNonClosedIncidents,
  updateVersioned,
  type AssignedIncidentRow,
  type UpdateIncidentStateInput,
} from '../incidents/incident.repository';
import { activeTiers, replaceTierSet } from '../escalation/tiers.repository';
import { toAdminUserRow } from './admin.mapper';
import {
  activeAdminIdsForUpdate,
  findUserById,
  listUsers as listUsersRepo,
  updateUserClearance,
  updateUserRole,
  updateUserStatus,
} from './admin.repository';

export async function listUsers(query: AdminUsersQuery): Promise<AdminUsersResponse> {
  const { items, totalItems } = await listUsersRepo(query);
  return buildOffsetPage(items.map(toAdminUserRow), totalItems, query.page, query.pageSize);
}

function assertNotSelf(actor: Actor, targetId: string): void {
  if (actor.id === targetId) throw new SelfModificationForbiddenError();
}

async function loadTargetOrThrow(targetId: string) {
  const user = await findUserById(targetId);
  if (!user) throw new NotFoundError('User', targetId);
  return user;
}

/**
 * Incidents `userId` is currently assigned to that a clearance of `newClearance`
 * could no longer cover — the exact set assignment.policy.ts::mustUnassignOnRaise
 * already identifies for Q17's own severity-raise cascade, applied here across all of
 * one user's assignments instead of one incident's severity change. Empty whenever
 * `newClearance` is not an actual lowering for that incident's severity.
 */
async function computeClearanceImpact(userId: string, newClearance: number): Promise<AssignedIncidentRow[]> {
  const assigned = await findAssignedNonClosedIncidents(userId);
  return assigned.filter((incident) => mustUnassignOnRaise(newClearance, incident.severity));
}

/**
 * The read-only twin of changeClearance's own cascade — computes exactly what a
 * lowering PATCH would do, without writing anything, so ClearanceImpactDialog can list
 * affected incidents by reference BEFORE the admin confirms (build-plan.md §15.2).
 */
export async function previewClearanceImpact(targetId: string, newClearance: number): Promise<ClearanceImpactResponse> {
  await loadTargetOrThrow(targetId);
  const affected = await computeClearanceImpact(targetId, newClearance);
  return {
    affectedIncidents: affected.map((incident) => ({ id: incident.id, reference: incident.reference, severity: incident.severity })),
    count: affected.length,
  };
}

/** build-plan.md §15.1 rule 1: no accidental lockout, no self-escalation. */
export async function changeRole(actor: Actor, targetId: string, role: Role): Promise<AdminUserMutationResponse> {
  assertNotSelf(actor, targetId);
  const target = await loadTargetOrThrow(targetId);
  if (target.role === role) return { user: toAdminUserRow(target), affectedIncidentCount: 0 };

  const now = new Date();
  const updated = await withTransaction(async (tx) => {
    if (target.role === 'ADMIN' && target.isActive && role !== 'ADMIN') {
      const activeAdminIds = await activeAdminIdsForUpdate(tx);
      if (activeAdminIds.length <= 1 && activeAdminIds.includes(target.id)) throw new LastAdminError();
    }

    const result = await updateUserRole(targetId, role, tx);
    await auditService.record(tx, {
      actorId: actor.id,
      type: 'USER_ROLE_CHANGED',
      fromValue: target.role,
      toValue: role,
      payload: { targetUserId: target.id, targetDisplayName: target.displayName },
      occurredAt: now,
    });
    return result;
  });

  return { user: toAdminUserRow(updated), affectedIncidentCount: 0 };
}

/**
 * build-plan.md §15.1 rule 3: lowering cascades — every stranded incident is
 * auto-unassigned and, if mid-investigation, returned to TRIAGE, with an
 * INVESTIGATOR_UNASSIGNED (+ STAGE_CHANGED where applicable) audit row each, mirroring
 * changeSeverity's own Q17 handling of the identical situation from the other
 * direction. The candidate set is computed once, before the transaction opens, then
 * each incident's own version guards the actual write — a race against a concurrent
 * per-incident mutation surfaces as StaleVersionError, failing the whole PATCH so the
 * admin can retry, exactly like every other multi-row mutation in this codebase.
 */
export async function changeClearance(actor: Actor, targetId: string, clearanceLevel: number): Promise<AdminUserMutationResponse> {
  assertNotSelf(actor, targetId);
  const target = await loadTargetOrThrow(targetId);
  if (target.clearanceLevel === clearanceLevel) return { user: toAdminUserRow(target), affectedIncidentCount: 0 };

  const isLowering = clearanceLevel < target.clearanceLevel;
  const affected = isLowering ? await computeClearanceImpact(targetId, clearanceLevel) : [];
  const now = new Date();

  const updated = await withTransaction(async (tx) => {
    const result = await updateUserClearance(targetId, clearanceLevel, tx);
    await auditService.record(tx, {
      actorId: actor.id,
      type: 'USER_CLEARANCE_CHANGED',
      fromValue: String(target.clearanceLevel),
      toValue: String(clearanceLevel),
      payload: { targetUserId: target.id, targetDisplayName: target.displayName },
      occurredAt: now,
    });

    for (const incident of affected) {
      const data: UpdateIncidentStateInput = { assignedInvestigatorId: null };
      if (incident.stage === 'INVESTIGATION') data.stage = 'TRIAGE';

      const count = await updateVersioned(tx, incident.id, incident.version, data);
      if (count !== 1) throw new StaleVersionError(incident.version);

      await auditService.record(tx, {
        incidentId: incident.id,
        actorId: actor.id,
        type: 'INVESTIGATOR_UNASSIGNED',
        fromValue: targetId,
        reason: 'ADMIN_CLEARANCE_LOWERED',
        occurredAt: now,
      });
      if (data.stage) {
        await auditService.record(tx, {
          incidentId: incident.id,
          actorId: actor.id,
          type: 'STAGE_CHANGED',
          fromValue: incident.stage,
          toValue: 'TRIAGE',
          reason: 'ADMIN_CLEARANCE_LOWERED',
          occurredAt: now,
        });
      }
    }

    return result;
  });

  return { user: toAdminUserRow(updated), affectedIncidentCount: affected.length };
}

/**
 * build-plan.md §15.1 rule 2, from the activation side. Self-deactivation is NOT
 * blocked by assertNotSelf — the spec's self-modification rule names only role and
 * clearance (§15.1 rule 1) — but the last-admin check still applies regardless of who
 * is doing the deactivating, so a lone admin can never lock the org out by
 * deactivating themselves either. No audit row: only role and clearance changes are
 * audited (implementation-plan.md §7, line 849) — activate/deactivate has no
 * AuditEventType of its own by design.
 */
export async function changeStatus(actor: Actor, targetId: string, isActive: boolean): Promise<AdminUserMutationResponse> {
  const target = await loadTargetOrThrow(targetId);
  if (target.isActive === isActive) return { user: toAdminUserRow(target), affectedIncidentCount: 0 };

  const updated = await withTransaction(async (tx) => {
    if (target.role === 'ADMIN' && target.isActive && !isActive) {
      const activeAdminIds = await activeAdminIdsForUpdate(tx);
      if (activeAdminIds.length <= 1 && activeAdminIds.includes(target.id)) throw new LastAdminError();
    }
    return updateUserStatus(targetId, isActive, tx);
  });

  return { user: toAdminUserRow(updated), affectedIncidentCount: 0 };
}

// ---------------------------------------------------------------------------
// Escalation tiers — the write side of GET /escalations/tiers (Module 7, auth-open,
// read-only). Contiguity/monotonicity are enforced entirely by TierSetRequestSchema
// before this ever runs.
// ---------------------------------------------------------------------------

export async function listTiers(): Promise<EscalationTiersResponse> {
  return { tiers: await activeTiers() };
}

export async function putTiers(actor: Actor, request: TierSetRequest): Promise<EscalationTiersResponse> {
  await withTransaction((tx) => replaceTierSet(request.tiers, actor.id, tx));
  return { tiers: await activeTiers() };
}

// ---------------------------------------------------------------------------
// Job diagnostics — read side of the JobRun rows Module 7's escalation job already
// writes. jobRunRepository.recent() was already built there for exactly this screen.
// ---------------------------------------------------------------------------

export async function listJobRuns(limit: number): Promise<AdminJobRunsResponse> {
  const runs = await jobRunRepository.recent('escalation', limit);
  return {
    runs: runs.map((run) => ({
      id: run.id,
      jobName: run.jobName,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      outcome: run.outcome as 'COMPLETED' | 'SKIPPED_LOCKED' | 'FAILED' | null,
      scanned: run.scanned,
      escalated: run.escalated,
      notified: run.notified,
      error: run.error,
    })),
  };
}
