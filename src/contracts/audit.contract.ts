import { z } from 'zod';
import { AuditEventTypeSchema, IncidentTypeSchema, SeveritySchema, StageSchema } from './enums';
import {
  csvArrayQueryParam,
  cursorEnvelopeSchema,
  cursorQuerySchema,
  offsetEnvelopeSchema,
  offsetQuerySchema,
} from './pagination.contract';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

const UserRefSchema = z.object({ id: z.string(), displayName: z.string() });

// ---------------------------------------------------------------------------
// GET /incidents/:id/timeline — one variant per AuditEventType that can actually carry
// an incidentId. USER_CLEARANCE_CHANGED/USER_ROLE_CHANGED (Module 10) never do, so they
// never reach this union; they only ever appear in the global /audit search below.
// A discriminated union (not a loose object) is deliberate: it is what lets the
// frontend's per-type renderer dispatch exhaustively, with a `never` check in the
// default branch that fails the build the day a 13th event type is added here without
// a matching renderer (build-plan.md, Module 8).
const BaseEventSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  // null for the escalation job's own INCIDENT_ESCALATED rows — a system actor, not a user.
  actor: UserRefSchema.nullable(),
});

export const IncidentCreatedEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_CREATED'),
  severity: SeveritySchema,
  incidentType: IncidentTypeSchema,
  stage: StageSchema,
});

export const StageChangedEventSchema = BaseEventSchema.extend({
  type: z.literal('STAGE_CHANGED'),
  from: StageSchema,
  to: StageSchema,
  reason: z.string().nullable(),
});

export const SeverityChangedEventSchema = BaseEventSchema.extend({
  type: z.literal('SEVERITY_CHANGED'),
  from: SeveritySchema,
  to: SeveritySchema,
  reason: z.string().nullable(),
});

// fromValue/toValue on the underlying AuditEvent row are plain user ids (no FK on that
// column) — resolved to a UserRef by the mapper via one batched lookup per page, never
// per event. Nullable defensively: a row referencing a user id that can no longer be
// resolved degrades to null rather than throwing.
export const InvestigatorAssignedEventSchema = BaseEventSchema.extend({
  type: z.literal('INVESTIGATOR_ASSIGNED'),
  investigator: UserRefSchema.nullable(),
});

export const InvestigatorUnassignedEventSchema = BaseEventSchema.extend({
  type: z.literal('INVESTIGATOR_UNASSIGNED'),
  investigator: UserRefSchema.nullable(),
  reason: z.string().nullable(),
});

export const IncidentAcknowledgedEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_ACKNOWLEDGED'),
});

// Redaction (§8.1, Module 8) never removes the row — a viewer who cannot read notes
// still sees THAT one was added and when, per docs/decisions.md — it only strips who
// wrote it and how long it was. `redacted` is the dispatch flag the frontend's
// TimelineEvent renderer uses to pick NoteAddedEvent vs. the muted RedactedEvent; the
// underlying AuditEventType stays NOTE_ADDED either way, so it is one schema, not two
// union members.
export const NoteAddedEventSchema = BaseEventSchema.extend({
  type: z.literal('NOTE_ADDED'),
  redacted: z.boolean(),
  noteId: z.string().nullable(),
  length: z.number().int().nullable(),
});

export const ClosureProposedEventSchema = BaseEventSchema.extend({
  type: z.literal('CLOSURE_PROPOSED'),
  rootCauseLength: z.number().int(),
  correctiveActionLength: z.number().int(),
});

export const ClosureApprovedEventSchema = BaseEventSchema.extend({
  type: z.literal('CLOSURE_APPROVED'),
});

export const ClosureRejectedEventSchema = BaseEventSchema.extend({
  type: z.literal('CLOSURE_REJECTED'),
  reason: z.string().nullable(),
});

export const IncidentEscalatedEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_ESCALATED'),
  fromLevel: z.number().int(),
  toLevel: z.number().int(),
  cycle: z.number().int(),
});

// ADMIN-only (filtered out of every other viewer's page server-side, before pagination
// — never redacted post-fetch, or a non-admin's page size would shrink unpredictably,
// the same class of bug B1 fixed elsewhere). Still typed here since an admin's own
// per-incident timeline goes through this exact union.
export const AccessDeniedEventSchema = BaseEventSchema.extend({
  type: z.literal('ACCESS_DENIED'),
  reason: z.string().nullable(),
  clearanceLevel: z.number().int().nullable(),
});

export const TimelineEventSchema = z.discriminatedUnion('type', [
  IncidentCreatedEventSchema,
  StageChangedEventSchema,
  SeverityChangedEventSchema,
  InvestigatorAssignedEventSchema,
  InvestigatorUnassignedEventSchema,
  IncidentAcknowledgedEventSchema,
  NoteAddedEventSchema,
  ClosureProposedEventSchema,
  ClosureApprovedEventSchema,
  ClosureRejectedEventSchema,
  IncidentEscalatedEventSchema,
  AccessDeniedEventSchema,
]);
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const TimelineQuerySchema = cursorQuerySchema.strict();
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;

export const TimelineResponseSchema = cursorEnvelopeSchema(TimelineEventSchema);
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

// ---------------------------------------------------------------------------
// GET /audit (ADMIN, Module 10's screen) — a flat row, not the discriminated union
// above: this table also carries USER_CLEARANCE_CHANGED/USER_ROLE_CHANGED (no
// incidentId at all) and every viewer here is already ADMIN, so nothing is redacted.
const IsoDateStringSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'must be a valid date');

export const AuditSearchQuerySchema = offsetQuerySchema
  .extend({
    type: csvArrayQueryParam(AuditEventTypeSchema),
    actorId: z.string().optional(),
    incidentId: z.string().optional(),
    from: IsoDateStringSchema.optional(),
    to: IsoDateStringSchema.optional(),
  })
  .strict();
export type AuditSearchQuery = z.infer<typeof AuditSearchQuerySchema>;

export const AuditRowSchema = z.object({
  id: z.string(),
  type: AuditEventTypeSchema,
  occurredAt: z.string(),
  actor: UserRefSchema.nullable(),
  incidentId: z.string().nullable(),
  incidentReference: z.string().nullable(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  reason: z.string().nullable(),
  payload: z.unknown().nullable(),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;

export const AuditSearchResponseSchema = offsetEnvelopeSchema(AuditRowSchema);
export type AuditSearchResponse = z.infer<typeof AuditSearchResponseSchema>;
