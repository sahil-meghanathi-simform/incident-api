import { HIGH_BAND_RANK, SEVERITY_RANK } from '../../config/constants';
import { canTransition } from '../../policy/stage.policy';
import { canReadNotes, canWriteNotes } from '../../policy/note.policy';
import { hasClosureRequirements } from '../../policy/closure.policy';
import type { Actor } from '../../types/actor.type';
import type { IncidentActions, IncidentDetail, IncidentListItem } from '../../contracts/incident.contract';
import type { IncidentDetailRow, IncidentListRow } from './incident.repository';

function canManage(actor: Actor): boolean {
  return actor.role === 'TRIAGE_MANAGER' || actor.role === 'ADMIN';
}

function isAssigneeOrAdmin(actor: Actor, incident: { assignedInvestigatorId: string | null }): boolean {
  return actor.role === 'ADMIN' || incident.assignedInvestigatorId === actor.id;
}

/**
 * Computed affordances only — a UI hint, never authority. Every action endpoint
 * (Modules 4-6) re-checks the same policies server-side against its own fresh read.
 * Derived entirely from the policy layer already built in Module 0/1, so there is no
 * second copy of these rules to drift from the real gates.
 */
function computeActions(actor: Actor, incident: IncidentDetailRow): IncidentActions {
  return {
    canTriage: canManage(actor) && canTransition(incident.stage, 'TRIAGE'),
    canAssign: canManage(actor) && incident.stage !== 'CLOSED',
    canAcknowledge:
      canManage(actor) &&
      SEVERITY_RANK[incident.severity] >= HIGH_BAND_RANK &&
      incident.acknowledgedAt === null &&
      incident.stage !== 'CLOSED',
    canReadNotes: canReadNotes(actor, incident),
    canAddNote: canWriteNotes(actor, incident),
    canProposeClosure: isAssigneeOrAdmin(actor, incident) && canTransition(incident.stage, 'PENDING_CLOSURE'),
    canApproveClosure: canManage(actor) && incident.stage === 'PENDING_CLOSURE' && hasClosureRequirements(incident),
  };
}

export function toIncidentListItem(incident: IncidentListRow): IncidentListItem {
  return {
    id: incident.id,
    reference: incident.reference,
    type: incident.type,
    severity: incident.severity,
    stage: incident.stage,
    title: incident.title,
    assignedInvestigator: incident.assignee,
    acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
    currentEscalationLevel: incident.currentEscalationLevel,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
  };
}

/**
 * The per-field redaction point (§8.1). `assignedInvestigator`/`acknowledgement`/
 * `escalation` are OMITTED — not merely null — for a viewer not entitled to them, so
 * "no assignee" and "not your business" are distinguishable on the wire.
 * rootCause/correctiveAction are exposed to anyone who passed the clearance gate: they
 * are the closure record, not an investigation detail. Notes are never inlined here.
 */
export function toIncidentDetail(incident: IncidentDetailRow, actor: Actor): IncidentDetail {
  const canSeeAssignment = canManage(actor) || incident.assignedInvestigatorId === actor.id;
  const canSeeEscalation = canManage(actor);

  return {
    id: incident.id,
    reference: incident.reference,
    type: incident.type,
    severity: incident.severity,
    stage: incident.stage,
    title: incident.title,
    description: incident.description,
    reporter: incident.reporter,
    ...(canSeeAssignment && { assignedInvestigator: incident.assignee }),
    rootCause: incident.rootCause,
    correctiveAction: incident.correctiveAction,
    closure: incident.closedAt ? { closedAt: incident.closedAt.toISOString(), closedBy: incident.closer } : null,
    ...(canSeeEscalation && {
      acknowledgement: incident.acknowledgedAt
        ? { acknowledgedAt: incident.acknowledgedAt.toISOString(), acknowledgedBy: incident.acknowledger }
        : null,
      escalation: {
        currentEscalationLevel: incident.currentEscalationLevel,
        highSeveritySince: incident.highSeveritySince?.toISOString() ?? null,
        lastEscalatedAt: incident.lastEscalatedAt?.toISOString() ?? null,
      },
    }),
    version: incident.version,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    _actions: computeActions(actor, incident),
  };
}
