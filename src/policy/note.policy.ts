import { canViewSeverity } from './clearance.policy';
import type { Severity, Stage } from '../contracts/enums';
import type { Actor } from '../types/actor.type';

export interface NoteableIncident {
  severity: Severity;
  assignedInvestigatorId: string | null;
  stage: Stage;
}

/**
 * Two gates, in order: clearance (can the actor see the incident at all), then
 * assignment (are they the assignee, or Admin). Both are expressed AGAIN in the
 * repository's `where` clause on the related incident — this function is the
 * documentation of that query's intent, not a substitute for it (§ walkthrough Q2).
 */
export function canReadNotes(actor: Actor, incident: NoteableIncident): boolean {
  if (!canViewSeverity(actor, incident.severity)) return false;
  if (actor.role === 'ADMIN') return true;
  return incident.assignedInvestigatorId === actor.id;
}

export function canWriteNotes(actor: Actor, incident: NoteableIncident): boolean {
  if (!canReadNotes(actor, incident)) return false;
  return incident.stage === 'INVESTIGATION' || incident.stage === 'PENDING_CLOSURE';
}
