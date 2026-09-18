import type { IncidentType, Severity, Stage } from '../../contracts/enums';
import type { AuditRow, TimelineEvent } from '../../contracts/audit.contract';
import type { AuditEventRow, AuditSearchRow } from './audit.repository';

type UserRef = { id: string; displayName: string };

/**
 * One event type → one payload shape, decoded from the AuditEvent row's generic
 * fromValue/toValue/reason/payload columns. `userRefs` is the batch lookup result for
 * INVESTIGATOR_ASSIGNED/UNASSIGNED's raw id in fromValue/toValue — resolved once per
 * page by the caller, not here, so this function stays a pure, allocation-free mapper.
 *
 * Exhaustive only over the AuditEventType values that can actually carry an incidentId
 * (see audit.contract.ts) — USER_CLEARANCE_CHANGED/USER_ROLE_CHANGED (Module 10) never
 * do, so findTimelinePage's WHERE never returns one here; the default branch below
 * exists so a genuinely new, unhandled type fails loudly instead of mapping to
 * `undefined`.
 */
export function toTimelineEvent(
  row: AuditEventRow,
  canReadNotes: boolean,
  userRefs: ReadonlyMap<string, UserRef>,
): TimelineEvent {
  const base = { id: row.id, occurredAt: row.occurredAt.toISOString(), actor: row.actor };

  switch (row.type) {
    case 'INCIDENT_CREATED': {
      const payload = row.payload as { type: IncidentType; stage: Stage } | null;
      return {
        ...base,
        type: 'INCIDENT_CREATED',
        severity: row.toValue as Severity,
        incidentType: payload?.type ?? 'OTHER',
        stage: payload?.stage ?? 'REPORTED',
      };
    }
    case 'STAGE_CHANGED':
      return {
        ...base,
        type: 'STAGE_CHANGED',
        from: row.fromValue as Stage,
        to: row.toValue as Stage,
        reason: row.reason,
      };
    case 'SEVERITY_CHANGED':
      return {
        ...base,
        type: 'SEVERITY_CHANGED',
        from: row.fromValue as Severity,
        to: row.toValue as Severity,
        reason: row.reason,
      };
    case 'INVESTIGATOR_ASSIGNED':
      return {
        ...base,
        type: 'INVESTIGATOR_ASSIGNED',
        investigator: row.toValue ? userRefs.get(row.toValue) ?? null : null,
      };
    case 'INVESTIGATOR_UNASSIGNED':
      return {
        ...base,
        type: 'INVESTIGATOR_UNASSIGNED',
        investigator: row.fromValue ? userRefs.get(row.fromValue) ?? null : null,
        reason: row.reason,
      };
    case 'INCIDENT_ACKNOWLEDGED':
      return { ...base, type: 'INCIDENT_ACKNOWLEDGED' };
    case 'NOTE_ADDED': {
      const payload = row.payload as { noteId: string; length: number } | null;
      if (!canReadNotes) {
        // §8.1: THAT a note exists, and when, is part of the record — who wrote it and
        // how long it was is not, for a viewer who never passed the two-gate rule.
        return {
          id: row.id,
          occurredAt: row.occurredAt.toISOString(),
          actor: null,
          type: 'NOTE_ADDED',
          redacted: true,
          noteId: null,
          length: null,
        };
      }
      return {
        ...base,
        type: 'NOTE_ADDED',
        redacted: false,
        noteId: payload?.noteId ?? null,
        length: payload?.length ?? null,
      };
    }
    case 'CLOSURE_PROPOSED': {
      const payload = row.payload as { rootCauseLength: number; correctiveActionLength: number } | null;
      return {
        ...base,
        type: 'CLOSURE_PROPOSED',
        rootCauseLength: payload?.rootCauseLength ?? 0,
        correctiveActionLength: payload?.correctiveActionLength ?? 0,
      };
    }
    case 'CLOSURE_APPROVED':
      return { ...base, type: 'CLOSURE_APPROVED' };
    case 'CLOSURE_REJECTED':
      return { ...base, type: 'CLOSURE_REJECTED', reason: row.reason };
    case 'INCIDENT_ESCALATED': {
      const payload = row.payload as { cycle: number; level: number } | null;
      return {
        ...base,
        type: 'INCIDENT_ESCALATED',
        fromLevel: Number(row.fromValue ?? 0),
        toLevel: Number(row.toValue ?? payload?.level ?? 0),
        cycle: payload?.cycle ?? 0,
      };
    }
    case 'ACCESS_DENIED': {
      const payload = row.payload as { clearanceLevel: number } | null;
      return { ...base, type: 'ACCESS_DENIED', reason: row.reason, clearanceLevel: payload?.clearanceLevel ?? null };
    }
    case 'USER_CLEARANCE_CHANGED':
    case 'USER_ROLE_CHANGED':
      throw new Error(`${row.type} audit events never carry an incidentId and cannot appear in a timeline page`);
    default: {
      const _exhaustive: never = row.type;
      throw new Error(`unmappable timeline event type: ${_exhaustive}`);
    }
  }
}

/** The flat admin row — every event type, no per-viewer redaction (the route is ADMIN-only). */
export function toAuditRow(row: AuditSearchRow): AuditRow {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actor,
    incidentId: row.incidentId,
    incidentReference: row.incident?.reference ?? null,
    fromValue: row.fromValue,
    toValue: row.toValue,
    reason: row.reason,
    payload: row.payload,
  };
}
