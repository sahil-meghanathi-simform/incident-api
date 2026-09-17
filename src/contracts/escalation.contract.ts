import { z } from 'zod';
import { SeveritySchema } from './enums';
import { cursorEnvelopeSchema, cursorQuerySchema } from './pagination.contract';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

const UserRefSchema = z.object({ id: z.string(), displayName: z.string() });

// ---------------------------------------------------------------------------
// Tiers — auth-open (any authenticated role, not just TRIAGE_MANAGER/ADMIN): the
// write is admin-only (Module 10), but reading the thresholds is what lets a
// clearance-1 reporter's severity picker show "escalates in 15m if unacknowledged"
// before they ever submit. Documented explicitly in docs/escalation.md.
export const EscalationTierDtoSchema = z.object({
  severity: SeveritySchema,
  level: z.number().int(),
  thresholdMinutes: z.number().int(),
});
export type EscalationTierDto = z.infer<typeof EscalationTierDtoSchema>;

export const EscalationTiersResponseSchema = z.object({ tiers: z.array(EscalationTierDtoSchema) });
export type EscalationTiersResponse = z.infer<typeof EscalationTiersResponseSchema>;

// ---------------------------------------------------------------------------
// Feed — GET /escalations. One row per actively-escalated (unacknowledged,
// non-CLOSED, currentEscalationLevel > 0) incident within the actor's clearance,
// carrying the incident's CURRENT escalation event (dueAt/triggeredAt) for the
// frontend's own locally-ticking SlaCountdown. Role-open (any authenticated actor),
// scoped purely by clearance — same visibilityScope every other incident read uses.
export const EscalationFeedItemSchema = z.object({
  incidentId: z.string(),
  incidentReference: z.string(),
  incidentTitle: z.string(),
  severity: SeveritySchema,
  level: z.number().int(),
  cycle: z.number().int(),
  dueAt: z.string(),
  triggeredAt: z.string(),
  assignedInvestigator: UserRefSchema.nullable(),
  // Carried so the frontend feed can offer "inline Acknowledge" (build-plan.md) without
  // a second round trip to fetch the incident detail just for its If-Match version.
  version: z.number().int(),
});
export type EscalationFeedItem = z.infer<typeof EscalationFeedItemSchema>;

export const EscalationFeedQuerySchema = cursorQuerySchema.strict();
export type EscalationFeedQuery = z.infer<typeof EscalationFeedQuerySchema>;

export const EscalationFeedResponseSchema = cursorEnvelopeSchema(EscalationFeedItemSchema);
export type EscalationFeedResponse = z.infer<typeof EscalationFeedResponseSchema>;

// Same regex-validated-id discipline as IncidentIdParamsSchema (S7) — a malformed id
// 422s at the validation layer instead of falling through to a confusing 404.
export const EscalationEventsParamsSchema = z
  .object({ incidentId: z.string().regex(/^[a-z0-9]{20,32}$/i, 'must be a valid incident id') })
  .strict();
export type EscalationEventsParams = z.infer<typeof EscalationEventsParamsSchema>;

// ---------------------------------------------------------------------------
// Per-incident escalation history — GET /escalations/:incidentId/events. The full
// tier-by-tier record (not just the current level), gated the same as the incident
// detail's own `escalation` field (§8.1: TRIAGE_MANAGER/ADMIN only) — a REPORTER
// sees THAT an incident is escalated (IncidentListItem.currentEscalationLevel is
// unconditional) but not this level-by-level history.
export const EscalationEventDtoSchema = z.object({
  id: z.string(),
  cycle: z.number().int(),
  level: z.number().int(),
  dueAt: z.string(),
  triggeredAt: z.string(),
});
export type EscalationEventDto = z.infer<typeof EscalationEventDtoSchema>;

export const IncidentEscalationEventsResponseSchema = z.object({ events: z.array(EscalationEventDtoSchema) });
export type IncidentEscalationEventsResponse = z.infer<typeof IncidentEscalationEventsResponseSchema>;

// ---------------------------------------------------------------------------
// Notifications — GET/POST /notifications. Recipient-scoped (recipientId = actor),
// AND clearance-scoped through the escalation event's incident (S2's second half: a
// notification earned at clearance 4 must disappear once clearance is lowered).
export const NotificationItemSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  incidentReference: z.string(),
  incidentTitle: z.string(),
  severity: SeveritySchema,
  level: z.number().int(),
  dueAt: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof NotificationItemSchema>;

export const NotificationsQuerySchema = cursorQuerySchema.strict();
export type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;

export const NotificationsResponseSchema = cursorEnvelopeSchema(NotificationItemSchema).extend({
  unreadCount: z.number().int(),
});
export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;

export const NotificationIdParamsSchema = z
  .object({ id: z.string().regex(/^[a-z0-9]{20,32}$/i, 'must be a valid notification id') })
  .strict();
export type NotificationIdParams = z.infer<typeof NotificationIdParamsSchema>;

// ---------------------------------------------------------------------------
// POST /jobs/escalation/run (admin) — the manual trigger the walkthrough uses to
// demonstrate double-run safety live (§15.2). Registered once, in this module (S7).
export const RunEscalationJobResponseSchema = z.object({
  outcome: z.enum(['COMPLETED', 'SKIPPED_LOCKED', 'FAILED']),
  scanned: z.number().int(),
  escalated: z.number().int(),
  notified: z.number().int(),
});
export type RunEscalationJobResponse = z.infer<typeof RunEscalationJobResponseSchema>;
