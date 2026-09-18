# API reference

Generated from the Zod schemas in `src/contracts/` (the same schemas `npm run
contracts:export` ships to `incident-web` verbatim — see `scripts/contracts-export.ts`).
Covers every endpoint registered by `src/http/router.ts` as of Module 10; grouped by
the module that owns it, not strictly by mount path, since several resources (triage
actions, notes, closure actions, timeline) are mounted on `incidentRouter` rather than
their own module's router. Request/response field lists below are non-exhaustive where
a schema is large — read the cited contract file for the authoritative shape.

## Conventions

- **Base path**: `/api/v1`, mounted in `src/app.ts`. `GET /health` is the only route
  registered directly on `apiRouter`; every other route lives on a module router
  mounted under it (`/auth`, `/users`, `/incidents`, `/triage`, `/investigations`,
  `/closures`, `/escalations`, `/notifications`, `/jobs`, `/audit`, `/analytics`,
  `/admin`).
- **Success responses are not wrapped.** A 2xx body is the resource or DTO itself —
  `res.status(200).json(result)` in every controller — not a `{ data: ... }` envelope.
  An offset-paginated list is `{ items, page, pageSize, totalItems, totalPages }`
  (`offsetEnvelopeSchema`, `src/contracts/pagination.contract.ts`); a cursor-paginated
  list is `{ items, nextCursor, hasMore }` (`cursorEnvelopeSchema`, same file) plus
  whatever extra fields that endpoint's schema adds (e.g. `unreadCount` on
  notifications).
- **Error envelope**: every non-2xx response is
  `{ error: { code, message, requestId, details?, meta? } }`
  (`src/contracts/errors.contract.ts::ErrorEnvelopeSchema`,
  `src/http/middleware/error.middleware.ts`). `details[]` (`{ path, code, message,
  received? }`) is present only on 422s and mirrors Zod's issue list, with `path` in
  dot notation so the frontend can call `setError(path, ...)` directly. `meta` carries
  action-specific extras (e.g. `requiredRoles` on `INSUFFICIENT_ROLE`, `expected` on
  `STALE_VERSION`). `code` is one of the values enumerated in `ErrorCodeSchema`
  (`src/contracts/errors.contract.ts`) — Module 11 hardening found and fixed five
  domain error codes (`SEVERITY_UNCHANGED`, `INVALID_ASSIGNMENT_TARGET`,
  `NO_INVESTIGATOR_ASSIGNED`, `INCIDENT_CLOSED`, `EMAIL_ALREADY_EXISTS`) that were
  thrown in practice but missing from that enum. Harmless at runtime (neither backend
  nor frontend ever calls `.parse()` against a real response with it), but it made
  this schema, and this file, wrong. Now complete.
- **Auth**: a short-lived Bearer access token (`Authorization: Bearer <token>`,
  verified by `authenticate.middleware.ts`) plus a long-lived httpOnly, `SameSite=Lax`
  refresh cookie scoped to `/api/v1/auth`. Every authenticated request re-reads
  `role`/`clearanceLevel` from the database by primary key — never from the JWT — so a
  role or clearance change is effective on the user's very next request. See
  `../docs/authorization.md` for the clearance model, the visibility-scope mechanism,
  and why this matters for revocation.
- **Optimistic concurrency**: every incident-mutating endpoint (triage, severity,
  assignment, acknowledge, closure proposal/approval/rejection) requires an `If-Match`
  header carrying the incident's current `version` (parsed by
  `http/middleware/ifMatch.middleware.ts`, enforced by the service's
  `updateVersioned`/`updateMany({ where: { id, version } })`). A missing or
  non-numeric header is `422 VALIDATION_FAILED`; a version that no longer matches is
  `409 STALE_VERSION`. Every one of these endpoints returns the fresh `IncidentDetail`
  (with the bumped `version` and recomputed `_actions`) so the client never needs a
  separate round trip before its next mutation.
- **Pagination** comes in two shapes, never mixed on one endpoint:
  - *Offset* (`offsetQuerySchema`: `page` ≥ 1, `pageSize` 1–100, default 25) for lists
    with a meaningful total (incident list, queues, admin users, audit search).
  - *Cursor* (`cursorQuerySchema`: opaque `cursor` string + `pageSize`) for feeds
    (notes, timeline, escalation feed, notifications). The cursor is a base64url JSON
    object `{ k, v }` (`src/core/pagination.ts`) where `k` tags which sort the cursor
    was minted for — `createdAt.id` (notes, notifications, and any other
    created-at-descending feed), `occurredAt.id` (timeline), or
    `level.highSeveritySince.id` (escalation feed, sorted
    `currentEscalationLevel DESC, highSeveritySince ASC, id ASC`). A cursor decoded
    against the wrong `k`, or one that isn't valid base64url JSON, is
    `422 CURSOR_SORT_MISMATCH` rather than silently mis-paginating.
- **Clearance and escalation semantics** (who can see which incidents, how escalation
  levels and notifications work, the tiered-threshold model) are not re-explained per
  endpoint below — see `authorization.md` and `escalation.md`. This file only states
  each endpoint's auth/role/clearance *gate*, not the reasoning behind it.

---

## Auth — `/auth` (`src/modules/auth/auth.router.ts`)

### `POST /auth/register`

Public, rate-limited (`authRateLimit()`, 15 min window — see
`rateLimit.middleware.ts`). Creates a `REPORTER` account.

- Body: `RegisterRequestSchema` (`email`, `password` 8–200 chars, `displayName`) —
  `.strict()`, so a smuggled `role`/`clearanceLevel` is `422`, not silently dropped.
- Response `201`: `AuthResponseSchema` (`{ accessToken, user: UserSummary }`) plus the
  refresh cookie set on the response.
- Errors: `409 EMAIL_ALREADY_EXISTS`, `429 RATE_LIMITED`, `422 VALIDATION_FAILED`.

### `POST /auth/login`

Public, same rate limit bucket as register.

- Body: `LoginRequestSchema` (`email`, `password`).
- Response `200`: `AuthResponseSchema`, refresh cookie set.
- Errors: `401 UNAUTHENTICATED` (wrong credentials — deliberately not
  distinguished from "no such user"), `429 RATE_LIMITED`.

### `POST /auth/refresh`

Public — authenticated only by the httpOnly refresh cookie, never a Bearer token; this
is the endpoint a client calls precisely because its access token is gone.

- No body. Reads the `refreshToken` cookie.
- Response `200`: `RefreshResponseSchema` (`{ accessToken }`), refresh cookie rotated.
- Errors: `401 UNAUTHENTICATED` if the cookie is missing or the session was revoked
  (cookie cleared either way before the error is thrown).

### `POST /auth/logout`

Authenticated.

- No body. Revokes the current refresh session server-side and clears the cookie.
- Response: `204` (no body).

### `GET /auth/me`

Authenticated.

- Response `200`: `MeResponseSchema` (= `UserSummarySchema`: `id`, `email`,
  `displayName`, `role`, `clearanceLevel`).

---

## Users — `/users` (`src/modules/users/users.router.ts`)

### `GET /users/assignable-investigators`

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`. Populates the investigator picker
on the assignment drawer.

- Query: `AssignableInvestigatorQuerySchema` (`minClearance` 1–4, optional — callers
  pass the incident's own severity rank to pre-filter).
- Response `200`: `{ investigators: AssignableInvestigator[] }` — `id`, `displayName`,
  `clearanceLevel` only, no email.
- Errors: `403 INSUFFICIENT_ROLE`.

---

## Incidents — `/incidents` (`src/modules/incidents/incident.router.ts`)

Literal segments (`/types`, `/mine`, `/summary`) are registered before `/:id` — Express
matches routes in registration order, and an unordered `/:id` would otherwise shadow
them (build-plan.md finding S7).

### `POST /incidents`

Authenticated, any role — incident creation is open to `REPORTER` and everyone above.

- Body: `CreateIncidentRequestSchema` (`type`, `severity`, `title` 5–160 chars,
  `description` 20–5000 chars) — `.strict()`; `reporterId`/`stage` can never be
  client-supplied.
- Response `201`, `Location: /api/v1/incidents/:id`: `IncidentReceiptSchema` (`id`,
  `reference`, `createdAt`, `severity`, `visibleToYou`). `visibleToYou` is a UI hint
  only — every subsequent read still re-checks clearance server-side (see
  `authorization.md`).
- Errors: `422 VALIDATION_FAILED`.

### `GET /incidents/types`

Authenticated. Static option lists for the create/edit form.

- Response `200`: `IncidentTypesResponseSchema` (`{ types: IncidentTypeOption[],
  severities: SeverityOption[] }`, each `{ value, label }`).

### `GET /incidents/mine`

Authenticated. The reporter's own incidents.

- Query: `MineQuerySchema` (= `offsetQuerySchema`: `page`, `pageSize`).
- Response `200`: `IncidentListResponse` (offset envelope of `IncidentListItem`).

### `GET /incidents/summary`

Authenticated. Stage counts for the actor's own dashboard tiles.

- Response `200`: `IncidentSummarySchema` (`{ counts: Record<Stage, number> }`),
  scoped by the actor's own `visibilityScope`.

### `GET /incidents`

Authenticated. The main incident list, scoped by clearance (`authorization.md`).

- Query: `ListIncidentsQuerySchema` — `offsetQuerySchema` plus `severity`/`stage`/
  `type` (CSV-or-repeated array params, see `csvArrayQueryParam`),
  `assignedToMe`/`reportedByMe`/`unacknowledged`/`escalatedOnly` (booleans), `from`/`to`
  (ISO date strings), free-text `q` (max 120 chars), `sort` (`createdAt` | `severity` |
  `updatedAt`, default `createdAt`), `order` (`asc`|`desc`, default `desc`). `.strict()`.
- Response `200`: `IncidentListResponse` (offset envelope of `IncidentListItemSchema`:
  `id`, `reference`, `type`, `severity`, `stage`, `title`, `assignedInvestigator`,
  `acknowledgedAt`, `currentEscalationLevel`, `createdAt`, `updatedAt`).
- Errors: `422 VALIDATION_FAILED` (bad enum value, `from`/`to` not parseable).

### `GET /incidents/:id`

Authenticated. The authorization decision (`getByIdForActor`) is a single
clearance-scoped query — see `authorization.md`'s by-ID walkthrough.

- Params: `IncidentIdParamsSchema` (`id` matches `/^[a-z0-9]{20,32}$/i`, else `422`
  rather than falling through to a confusing `404`).
- Response `200`: `IncidentDetailSchema` — full detail plus `version` (for the next
  `If-Match`) and `_actions` (`IncidentActionsSchema`: `canTriage`, `canAssign`,
  `canAcknowledge`, `canReadNotes`, `canAddNote`, `canProposeClosure`,
  `canApproveClosure` — UI hints only, never authoritative).
  `assignedInvestigator`/`acknowledgement`/`escalation` are **omitted** (not merely
  `null`) for a viewer not entitled to them (Triage/Admin/the assignee only); `closure`,
  `rootCause`, `correctiveAction` are visible to anyone who passed the clearance gate.
- Errors: `403 INSUFFICIENT_CLEARANCE`, `404 NOT_FOUND`, `422 VALIDATION_FAILED` (bad id
  shape).

### `POST /incidents/:id/triage` — Module 4

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`, `If-Match` required. Moves
`REPORTED → TRIAGE` (`src/policy/stage.policy.ts::assertTransition`).

- Params: `IncidentIdParamsSchema`.
- Response `200`: `TriageActionResponseSchema` (= `IncidentDetailSchema`).
- Errors: `403 INSUFFICIENT_ROLE`, `409 INVALID_STAGE_TRANSITION` (not `REPORTED`),
  `409 STALE_VERSION`, `404 NOT_FOUND`.

### `PATCH /incidents/:id/severity` — Module 4

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`, `If-Match` required. Raising,
lowering within the HIGH/CRITICAL band, entering, or leaving the band are all
supported — see `escalation.md`'s "Lowering severity WITHIN the band" for the exact
clock semantics (`triage.service.ts::applySeverityChange`).

- Body: `ChangeSeverityRequestSchema` (`severity`, `reason` 10–500 chars, whitespace
  doesn't count toward the minimum).
- Response `200`: `IncidentDetail`. If the change strands the current assignee (their
  clearance no longer covers the new severity), the incident is auto-unassigned and,
  if it was `INVESTIGATION`, reverted to `TRIAGE` — both recorded as separate audit
  events (`INVESTIGATOR_UNASSIGNED`, `STAGE_CHANGED`, reason
  `CLEARANCE_BELOW_NEW_SEVERITY`).
- Errors: `403 INSUFFICIENT_ROLE`, `409 INCIDENT_CLOSED`, `409 SEVERITY_UNCHANGED`
  (requested severity equals current), `409 STALE_VERSION`, `422 VALIDATION_FAILED`.

### `POST /incidents/:id/assignment` — Module 4

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`, `If-Match` required. Assigns (or
reassigns) an investigator; assigning out of `TRIAGE` advances the stage to
`INVESTIGATION`.

- Body: `AssignInvestigatorRequestSchema` (`investigatorId`, id-shaped).
- Response `200`: `IncidentDetail`.
- Errors: `403 INSUFFICIENT_ROLE`, `404 NOT_FOUND` (no such investigator),
  `409 INVALID_ASSIGNMENT_TARGET` (target isn't an active `INVESTIGATOR`),
  `409 INVESTIGATOR_CLEARANCE_TOO_LOW` (`meta: { required, actual }`),
  `409 INCIDENT_CLOSED`, `409 STALE_VERSION`.

### `DELETE /incidents/:id/assignment` — Module 4

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`, `If-Match` required. Removes the
current assignee.

- Params: `IncidentIdParamsSchema`.
- Response `200`: `IncidentDetail`.
- Errors: `403 INSUFFICIENT_ROLE`, `409 NO_INVESTIGATOR_ASSIGNED`,
  `409 INVALID_STAGE_TRANSITION` (cannot unassign while a closure is pending review),
  `409 INCIDENT_CLOSED`, `409 STALE_VERSION`.

### `POST /incidents/:id/acknowledge` — Module 4

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`, `If-Match` required. Acknowledges
the incident's current escalation cycle (stops further tier notifications for this
cycle; see `escalation.md`).

- Params: `IncidentIdParamsSchema`.
- Response `200`: `IncidentDetail`.
- Errors: `403 INSUFFICIENT_ROLE`, `409 ALREADY_ACKNOWLEDGED`, `409 INCIDENT_CLOSED`,
  `409 STALE_VERSION`.

### `GET /incidents/:id/notes` — Module 5

Authenticated, no static role gate. Enforces the two-gate rule (clearance AND
assignment-or-Admin) — see `authorization.md`'s note on the two-gate rule. Not
`If-Match`-gated: notes never touch the incident's `version`.

- Params: `IncidentIdParamsSchema`. Query: `NotesCursorQuerySchema` (`cursor`,
  `pageSize`).
- Response `200`: `NotesPageResponseSchema` (cursor envelope of `InvestigationNote`:
  `id`, `incidentId`, `author`, `body`, `createdAt`). Cursor key `createdAt.id`.
- Errors: `403 INSUFFICIENT_CLEARANCE`, `403 NOT_ASSIGNED_INVESTIGATOR` (visible but not
  the assignee/Admin), `422 CURSOR_SORT_MISMATCH`.

### `POST /incidents/:id/notes` — Module 5

Authenticated, same two-gate rule as the read above, plus a stage gate: notes may only
be added while the incident is `INVESTIGATION`.

- Body: `AddNoteRequestSchema` (`body` 5–4000 chars, whitespace-trimmed before the
  length check).
- Response `201`: `InvestigationNote`.
- Errors: `403 INSUFFICIENT_CLEARANCE`, `403 NOT_ASSIGNED_INVESTIGATOR`,
  `409 INVALID_STAGE_TRANSITION` (`meta.reason: 'NOTES_CLOSED'` — reused code, no real
  from/to transition), `422 VALIDATION_FAILED`.

### `POST /incidents/:id/closure-proposal` — Module 6

Authenticated, no static role gate (assignee-or-Admin is a per-incident check, same
pattern as notes), `If-Match` required. `INVESTIGATION → PENDING_CLOSURE`.

- Body: `ProposeClosureRequestSchema` (`rootCause`, `correctiveAction`, each ≥20 chars
  trimmed).
- Response `200`: `ClosureActionResponseSchema` (= `IncidentDetail`).
- Errors: `403 NOT_ASSIGNED_INVESTIGATOR`, `409 STALE_VERSION`,
  `422 VALIDATION_FAILED`.

### `POST /incidents/:id/closure-approval` — Module 6

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`, `If-Match` required.
`PENDING_CLOSURE → CLOSED`.

- Body: `ApproveClosureRequestSchema` — empty object, `.strict()` (any smuggled key is
  `422`, before the service's own re-read of the DB row is even consulted).
- Response `200`: `IncidentDetail`.
- Errors: `403 INSUFFICIENT_ROLE`, `409 CLOSURE_REQUIREMENTS_MISSING` (root
  cause/corrective action missing on the current DB row, re-checked server-side, not
  trusted from the earlier proposal), `409 STALE_VERSION`.

### `POST /incidents/:id/closure-rejection` — Module 6

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`, `If-Match` required.
`PENDING_CLOSURE → INVESTIGATION`, with the root cause/corrective action text
retained for the investigator to revise rather than retype.

- Body: `RejectClosureRequestSchema` (`reason` ≥10 chars trimmed).
- Response `200`: `IncidentDetail`.
- Errors: `403 INSUFFICIENT_ROLE`, `409 INVALID_STAGE_TRANSITION` (not currently
  `PENDING_CLOSURE`), `409 STALE_VERSION`.

### `GET /incidents/:id/timeline` — Module 8

Authenticated, no static role gate (clearance-scoped via `getByIdForActor`, then
per-viewer redacted). Not `If-Match`-gated.

- Query: `TimelineQuerySchema` (`cursor`, `pageSize`).
- Response `200`: `TimelineResponseSchema` (cursor envelope of `TimelineEvent`).
  `TimelineEvent` is a `z.discriminatedUnion('type', [...])` over 12 variants
  (`INCIDENT_CREATED`, `STAGE_CHANGED`, `SEVERITY_CHANGED`, `INVESTIGATOR_ASSIGNED`,
  `INVESTIGATOR_UNASSIGNED`, `INCIDENT_ACKNOWLEDGED`, `NOTE_ADDED`,
  `CLOSURE_PROPOSED`, `CLOSURE_APPROVED`, `CLOSURE_REJECTED`, `INCIDENT_ESCALATED`,
  `ACCESS_DENIED`) — see `src/contracts/audit.contract.ts` for each variant's own
  fields. `NOTE_ADDED` carries a `redacted: boolean` flag: a viewer without note access
  still sees that a note was added and when, never who wrote it or its length, when
  `redacted` is true. `ACCESS_DENIED` rows are filtered server-side to `ADMIN` viewers
  only, before pagination. Cursor key `occurredAt.id`.
- Errors: `403 INSUFFICIENT_CLEARANCE`, `422 CURSOR_SORT_MISMATCH`.

---

## Triage queue — `/triage` (`src/modules/triage/triage.router.ts`)

### `GET /triage/queue`

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`.

- Query: `TriageQueueQuerySchema` (= `offsetQuerySchema`).
- Response `200`: `TriageQueueResponseSchema` (offset envelope of `IncidentListItem`).
- Errors: `403 INSUFFICIENT_ROLE`.

---

## Investigations — `/investigations` (`src/modules/investigation/investigation.router.ts`)

### `GET /investigations/mine`

Authenticated, role-gated `INVESTIGATOR`/`ADMIN`. The assigned-to-me incident list.

- Query: `MyInvestigationsQuerySchema` (= `offsetQuerySchema`).
- Response `200`: `MyInvestigationsResponseSchema` (offset envelope of
  `IncidentListItem` — same shape the incident list table already renders).
- Errors: `403 INSUFFICIENT_ROLE`.

---

## Closures — `/closures` (`src/modules/closure/closure.router.ts`)

### `GET /closures/pending`

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN`. The approval queue.

- Query: `ClosuresPendingQuerySchema` (= `offsetQuerySchema`).
- Response `200`: `ClosuresPendingResponseSchema` (offset envelope of
  `IncidentListItem`).
- Errors: `403 INSUFFICIENT_ROLE`.

---

## Escalations — `/escalations` and `/jobs` (`src/modules/escalation/escalation.router.ts`)

Semantics (exactly-once escalation, the read-side clearance scoping, the feed's
one-row-per-incident shape) are documented in `escalation.md`, not repeated here.

### `GET /escalations`

Authenticated, role-open (any actor — clearance is the only gate, matching
`GET /incidents`).

- Query: `EscalationFeedQuerySchema` (= `cursorQuerySchema`).
- Response `200`: `EscalationFeedResponseSchema` (cursor envelope of
  `EscalationFeedItem`: `incidentId`, `incidentReference`, `incidentTitle`,
  `severity`, `level`, `cycle`, `dueAt`, `triggeredAt`, `assignedInvestigator`,
  `version` — `version` is included so the frontend can offer an inline
  acknowledge action without a second round trip). Cursor key
  `level.highSeveritySince.id`; one row per actively-escalated incident, not one per
  historical `EscalationEvent`.
- Errors: `422 CURSOR_SORT_MISMATCH`.

### `GET /escalations/tiers`

Authenticated, role-open (deliberately — the frontend's SLA countdown tooltips need
the thresholds regardless of role; see `escalation.md`).

- Response `200`: `EscalationTiersResponseSchema` (`{ tiers: EscalationTierDto[] }`,
  each `{ severity, level, thresholdMinutes }`).

### `GET /escalations/:incidentId/events`

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN` — mirrors the incident detail's own
`escalation` field gate; a `REPORTER` sees *that* an incident is escalated
(`IncidentListItem.currentEscalationLevel`) but not the level-by-level history.

- Params: `EscalationEventsParamsSchema` (`incidentId`, id-shaped).
- Response `200`: `IncidentEscalationEventsResponseSchema` (`{ events:
  EscalationEventDto[] }`, each `{ id, cycle, level, dueAt, triggeredAt }`).
- Errors: `403 INSUFFICIENT_ROLE`, `403 INSUFFICIENT_CLEARANCE` (can't see the
  incident at all), `404 NOT_FOUND`.

### `POST /jobs/escalation/run`

Authenticated, role-gated `ADMIN`. Manually triggers one pass of the escalation job
(the walkthrough's live double-run-safety demo). Registered exactly once, here, on a
separately-mounted `jobsRouter` (build-plan.md finding S7 — the reference plan
registered this route twice with two different middleware chains).

- No body.
- Response `200`: `RunEscalationJobResponseSchema` (`{ outcome: 'COMPLETED' |
  'SKIPPED_LOCKED' | 'FAILED', scanned, escalated, notified }`). `SKIPPED_LOCKED` is a
  normal `200`, not an error — it means a concurrent run already held the job's
  `JobLease` (see `escalation.md`'s load-test section).
- Errors: `403 INSUFFICIENT_ROLE`.

---

## Notifications — `/notifications` (`src/modules/escalation/notification.router.ts`)

### `GET /notifications`

Authenticated, no role gate (a `REPORTER`'s list is always empty by construction —
only `TRIAGE_MANAGER`/`ADMIN` ever receive `NotificationLog` rows). Recipient- and
clearance-scoped (see `escalation.md`'s read-side section).

- Query: `NotificationsQuerySchema` (= `cursorQuerySchema`).
- Response `200`: `NotificationsResponseSchema` (cursor envelope of
  `NotificationItem`: `id`, `incidentId`, `incidentReference`, `incidentTitle`,
  `severity`, `level`, `dueAt`, `readAt`, `createdAt`, plus a top-level
  `unreadCount`). Cursor key `createdAt.id`.
- Errors: `422 CURSOR_SORT_MISMATCH`.

### `POST /notifications/:id/read`

Authenticated. Marks one notification read.

- Params: `NotificationIdParamsSchema` (id-shaped).
- Response `200`: `NotificationItem` (updated row).
- Errors: `404 NOT_FOUND` (no such notification, or not this actor's).

---

## Audit — `/audit` (`src/modules/audit/audit.router.ts`)

### `GET /audit`

Authenticated, role-gated `ADMIN`. The global cross-incident search screen — distinct
from `GET /incidents/:id/timeline`, which any clearance-eligible actor can read for one
incident. Nothing is redacted here since every viewer is already `ADMIN`.

- Query: `AuditSearchQuerySchema` — `offsetQuerySchema` plus `type` (CSV/repeated
  `AuditEventType[]`), `actorId`, `incidentId`, `from`/`to` (ISO date strings).
  `.strict()`.
- Response `200`: `AuditSearchResponseSchema` (offset envelope of `AuditRow`: `id`,
  `type`, `occurredAt`, `actor`, `incidentId`, `incidentReference`, `fromValue`,
  `toValue`, `reason`, `payload` — a flat row, not the discriminated union the
  per-incident timeline uses, since this table also carries
  `USER_CLEARANCE_CHANGED`/`USER_ROLE_CHANGED` rows that have no `incidentId` at all).
- Errors: `403 INSUFFICIENT_ROLE`, `422 VALIDATION_FAILED`.

---

## Analytics — `/analytics` (`src/modules/analytics/analytics.router.ts`)

`overview`/`by-type-severity`/`trend`/`export.csv` are role-open, clearance-scoped —
two users legitimately seeing different totals for the same period is the point (build
plan §1.8), not something to also gate by role. All four period-based queries share
`AnalyticsPeriodFieldsSchema` (`from`, `to` ISO date strings, optional `type`/`stage`
CSV filters) plus a `superRefine` (`periodRefinement`) that 422s a reversed range or
one spanning more than `ANALYTICS_MAX_RANGE_DAYS` (366) days. The range is always
half-open `[from, to)`.

### `GET /analytics/overview`

Authenticated.

- Query: `AnalyticsOverviewQuerySchema`.
- Response `200`: `AnalyticsOverviewResponseSchema` (`period`, `totalIncidents`,
  `openIncidents`, `escalatedIncidents`, `medianAckSeconds` — nullable, no acknowledged
  incidents in range).
- Errors: `422 VALIDATION_FAILED` (`"to" must not be before "from"`, or the
  366-day-span message).

### `GET /analytics/by-type-severity`

Authenticated.

- Query: `AnalyticsMatrixQuerySchema`.
- Response `200`: `TypeSeverityMatrixResponseSchema` (`period`, `severities` — echoes
  exactly the columns this actor's clearance can see, never all four unconditionally —
  `cells: TypeSeverityCell[]`, `rowTotals`, `columnTotals`, `grandTotal`).
- Errors: `422 VALIDATION_FAILED`.

### `GET /analytics/trend`

Authenticated.

- Query: `AnalyticsTrendQuerySchema` (period fields plus `bucket`: `day`|`week`|`month`,
  default `day`).
- Response `200`: `TrendResponseSchema` (`period`, `bucket`, `severities`,
  `points: TrendPoint[]` — `{ bucketStart, severity, count }`).
- Errors: `422 VALIDATION_FAILED`.

### `GET /analytics/escalation-performance`

Authenticated, role-gated `TRIAGE_MANAGER`/`ADMIN` (the one analytics endpoint that
keeps a role gate, per the reference plan — only its missing clearance scope was a
defect, build-plan.md finding S2).

- Query: `AnalyticsEscalationPerformanceQuerySchema`.
- Response `200`: `EscalationPerformanceResponseSchema` (`period`,
  `bySeverity: EscalationPerformanceRow[]` — `{ severity, escalatedCount,
  acknowledgedCount, medianAckSeconds, p90AckSeconds }`, both ack-time fields
  nullable).
- Errors: `403 INSUFFICIENT_ROLE`, `422 VALIDATION_FAILED`.

### `GET /analytics/export.csv`

Authenticated, clearance-scoped like the other three open analytics endpoints.

- Query: `AnalyticsExportQuerySchema`.
- Response `200`: `text/csv`, `Content-Disposition: attachment;
  filename="incident-analytics-<from>-to-<to>.csv"`. Not a JSON body — no contract
  schema for the payload itself, only for the query.
- Errors: `422 VALIDATION_FAILED`.

---

## Admin — `/admin` (`src/modules/admin/admin.router.ts`)

The whole router is mounted behind `authenticate` + `authorizeRole('ADMIN')` at the
router level (`adminRouter.use(...)`), not per handler — build-plan.md §15.1. Every
endpoint below additionally returns `403 INSUFFICIENT_ROLE` for a non-Admin, which is
omitted from each entry's error list to avoid repeating it eleven times.

### `GET /admin/users`

- Query: `AdminUsersQuerySchema` — `offsetQuerySchema` plus `role` (CSV/repeated),
  `isActive` (boolean), free-text `q` (max 120 chars).
- Response `200`: `AdminUsersResponseSchema` (offset envelope of `AdminUserRow`: `id`,
  `email`, `displayName`, `role`, `clearanceLevel`, `isActive`, `createdAt`).

### `GET /admin/users/:id/clearance-impact`

Read-only preview the confirmation dialog calls before a clearance-lowering `PATCH` —
computes the exact same affected-incident set the write's own cascade would touch,
without writing anything.

- Params: `AdminUserIdParamsSchema`. Query: `ClearanceImpactQuerySchema`
  (`clearanceLevel` 1–4, the proposed new value).
- Response `200`: `ClearanceImpactResponseSchema` (`{ affectedIncidents:
  ClearanceImpactIncident[], count }`, each incident `{ id, reference, severity }`).
- Errors: `404 NOT_FOUND`.

### `PATCH /admin/users/:id/role`

No accidental lockout, no self-escalation (build-plan.md §15.1 rule 1).

- Body: `ChangeRoleRequestSchema` (`role`).
- Response `200`: `AdminUserMutationResponseSchema` (`{ user: AdminUserRow,
  affectedIncidentCount }` — always `0` here; only a clearance *lowering* can strand an
  assignment).
- Errors: `404 NOT_FOUND`, `409 SELF_MODIFICATION_FORBIDDEN` (actor targeting their own
  id), `409 LAST_ADMIN` (would demote the sole active Admin).

### `PATCH /admin/users/:id/clearance`

Lowering clearance below an existing assignment's requirement auto-unassigns that
investigator from every affected incident, each recorded as its own
`StaleVersionError`-safe per-incident update — a version conflict on one incident fails
the whole `PATCH`, same as any other multi-row mutation here.

- Body: `ChangeClearanceRequestSchema` (`clearanceLevel` 1–4).
- Response `200`: `AdminUserMutationResponseSchema` (`affectedIncidentCount` reflects
  the real cascade this time).
- Errors: `404 NOT_FOUND`, `409 SELF_MODIFICATION_FORBIDDEN`, `409 STALE_VERSION`
  (a per-incident cascade update lost a race).

### `PATCH /admin/users/:id/status`

Activate/deactivate. No dedicated `AuditEventType` — by design, not an oversight.

- Body: `ChangeStatusRequestSchema` (`isActive`).
- Response `200`: `AdminUserMutationResponseSchema` (`affectedIncidentCount` always
  `0`).
- Errors: `404 NOT_FOUND`, `409 SELF_MODIFICATION_FORBIDDEN`, `409 LAST_ADMIN`
  (deactivating the sole active Admin).

### `GET /admin/escalation-tiers`

The write-capable counterpart to the auth-open `GET /escalations/tiers`.

- Response `200`: `EscalationTiersResponseSchema`.

### `PUT /admin/escalation-tiers`

Replaces the full tier set, validated as a set (not row-by-row): levels contiguous
from 1 within each severity, thresholds strictly increasing within each severity — all
enforced in the Zod schema's `superRefine` (`TierSetRequestSchema`), so a violation is
an ordinary `422` from `validate()`, never a bespoke service-layer error.

- Body: `TierSetRequestSchema` (`{ tiers: TierInput[] }`, each `{ severity, level,
  thresholdMinutes }`).
- Response `200`: `EscalationTiersResponseSchema` (the new set).
- Errors: `422 VALIDATION_FAILED` (duplicate `(severity, level)`, non-contiguous
  levels, or non-increasing thresholds — all reported via `details[].path: 'tiers'`).

### `GET /admin/jobs/escalation/runs`

Recent escalation job run history (for the Admin screen showing the walkthrough's
double-run demo).

- Query: `AdminJobRunsQuerySchema` (`limit` 1–50, default 20).
- Response `200`: `AdminJobRunsResponseSchema` (`{ runs: AdminJobRun[] }`, each `{ id,
  jobName, startedAt, finishedAt, outcome, scanned, escalated, notified, error }`,
  `outcome`/`finishedAt`/`error` nullable for a run still in progress or one still
  being written).

---

## Health

### `GET /health`

Public, no authentication. Mounted before any `authenticate` middleware is applied
anywhere in the app (`src/http/router.ts`) — required by the compose healthcheck and
the `api → migrate-seed` `depends_on` chain (build-plan.md finding B6).

```jsonc
// 200
{ "status": "ok", "dbLatencyMs": 3, "contractVersion": "0.1.0" }
```

No request-scoped auth, so there is no error envelope case beyond a `500` if the
`SELECT 1` itself fails.
