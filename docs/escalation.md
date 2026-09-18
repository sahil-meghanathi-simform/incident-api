# Escalation

## Where the correctness guarantees actually come from

The reference plan's own property table (§12.1) attributed the guarantees to the wrong
mechanisms — see `../build-plan.md` finding B2 for the full analysis. Stated correctly:

- **Exactly-once escalation** comes from the unique index
  `EscalationEvent(incidentId, cycle, level)`, reached via
  `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. `currentEscalationLevel` on the
  `Incident` row is a **performance pre-filter only** — it has no correctness role. A
  run where the counter disagrees with the event history (a bad seed, a restored dump,
  a manual `UPDATE`) still completes cleanly and creates zero duplicates; see
  `tests/scenarios/escalation-idempotency.spec.ts::"is a no-op when
  currentEscalationLevel disagrees..."`.
- **Exactly-once notification** comes from notification rows being written in the
  SAME transaction as, and only when, the event insert actually returned a row — not
  from the `NotificationLog(escalationEventId, recipientId)` unique index alone, which
  only dedupes *within* one `createMany` call and cannot dedupe across runs (a
  conflicting run would generate a different `escalationEventId`).
- **Safety under concurrent instances** comes from a durable `JobLease` row (new model,
  not in the reference plan's schema). A `pg_try_advisory_xact_lock` still exists, but
  it only guards the sub-millisecond *claim* of that row, not the whole scan — the
  reference plan's lock guarded a single multi-minute transaction, which hits Prisma's
  5-second default transaction timeout at load and holds row locks for the run's full
  duration. Each batch of 500 candidates now runs as its own short transaction, with
  the lease renewed per batch.
- **Safety under a long gap between runs** comes from `tiersDueFor` (pure function,
  `src/jobs/escalation.job.ts`) computing elapsed time from `highSeveritySince`, never
  from "time since the job last ran". A 3-day gap produces levels 1, 2 and 3 in a
  single pass, one row each, in ascending order.
- **The ack/escalate race** — an incident acknowledged between the batch read and the
  batch write — is closed by re-checking `acknowledgedAt`/`stage`/
  `currentEscalationLevel` INSIDE the `INSERT ... SELECT ... WHERE`, not only in the
  earlier `findMany`. This shrinks the race window from "the whole run" (under the
  reference plan's single transaction) to one statement.

## The clock (Q19)

`highSeveritySince` is set the moment an incident's severity enters the HIGH/CRITICAL
band — at creation if born there, or on a severity change (Module 4). It is NEVER null
while severity is HIGH/CRITICAL (enforced by the `high_severity_clock` CHECK
constraint) and is cleared when severity drops below the band.

## Tiered thresholds

Seeded from `ESCALATION_HIGH_L1_MINUTES` etc. (`.env`) into `EscalationTier`, editable
by Admin (Module 10). `GET /escalations/tiers` is intentionally open to any
authenticated user (the frontend's SLA countdown tooltips need it) even though writing
tiers is Admin-only — a deliberate disclosure, not an oversight.

## Lowering severity WITHIN the band (Module 4, build-plan.md finding S1)

The reference plan's §9.1 enumerates three cases for a severity change — entering the
band, moving up within it, leaving it — and never states what happens when a triage
manager lowers CRITICAL to HIGH (permitted; a triager can revise severity in either
direction). Both "obvious" completions of the missing case are defects: nulling
`highSeveritySince` while still HIGH violates the `high_severity_clock` CHECK (a 500 on
a routine triage action); leaving `currentEscalationLevel` at the CRITICAL cycle's value
means the HIGH tier set can never fire, since `tiersDueFor` only returns tiers whose
`level > currentEscalationLevel`.

**Decision:** lowering within the band changes nothing about the clock. `highSeveritySince`
(Q19's origin), `escalationCycle`, `currentEscalationLevel` and any acknowledgement are
all preserved exactly as they were. The incident keeps being judged against the tier
thresholds it was already being judged against — a triager softening CRITICAL to HIGH
does not buy it a fresh grace period, nor does it re-notify anyone about a tier already
raised. This is implemented as a single total function over band membership,
`triage.service.ts::applySeverityChange`, so the four cases (enter, raise-within, lower-
within, leave) are exhaustive by construction rather than three cases plus an implicit
fallthrough. See `tests/unit/applySeverityChange.spec.ts` and the 48-case sweep in
`tests/scenarios/severity-change-sweep.spec.ts`.

## Notifications respect clearance too

Recipients for an escalation are triage managers/admins whose clearance is sufficient
to view the incident's severity — nobody is notified about an incident they could not
open. See `tests/scenarios/escalation-idempotency.spec.ts::"a clearance-2 triage
manager receives no notification..."`.

## The read side (Module 7, build-plan.md finding S2)

The reference plan's §12.1 role-gates `GET /escalations` to TRIAGE_MANAGER/ADMIN and
says nothing about clearance, so a clearance-2 manager could see CRITICAL references,
levels and overdue times in the feed — and a manager legitimately notified about a
CRITICAL escalation kept being served those `NotificationLog` rows after an admin
lowered their clearance below CRITICAL, with a drawer link to an incident that would
403. Both are incident reads the plan never identified as such. Fixed:

- `GET /escalations` and `GET /notifications` both compose `visibilityScope(actor)` —
  the feed through the incident directly, notifications through
  `escalationEvent.incident` — exactly like every other incident read in this codebase.
  See `tests/scenarios/escalation-clearance-scoping.spec.ts`.
- `GET /escalations` itself is deliberately **role-open** (any authenticated actor, not
  just TRIAGE_MANAGER/ADMIN), matching how `GET /incidents` already works and how the
  frontend's `SideNav` links it for every role — clearance is the gate, not role.
  `GET /escalations/:incidentId/events` (the full tier-by-tier history for one
  incident) is the one sub-resource still role-gated to TRIAGE_MANAGER/ADMIN, because
  it mirrors the incident detail's own `escalation` field, which the mapper already
  restricts to that population (§8.1) — a REPORTER can see THAT an incident is
  escalated (`IncidentListItem.currentEscalationLevel` is unconditional) but not the
  level-by-level record.

**Feed shape:** one row per actively-escalated incident (unacknowledged, non-CLOSED,
`currentEscalationLevel > 0`) — not one row per historical `EscalationEvent`. An
incident that reached level 3 has three event rows; acknowledging is incident-wide, so
a per-event feed would show three near-duplicate rows that all have to vanish together
on one click. The feed is a two-query design: an `Incident` scan (ordered
`currentEscalationLevel DESC, highSeveritySince ASC, id ASC`, the only fields available
for keyset pagination on that table) provides the page and its cursor, and a second
exact `(incidentId, cycle, level)` tuple lookup against `EscalationEvent`'s unique index
supplies the real `dueAt`/`triggeredAt` for display. Ordering by `highSeveritySince ASC`
within a level is exactly `dueAt ASC` (most overdue first) when comparing incidents of
the same severity, since the tier threshold for a given (severity, level) pair is
fixed; across two different severities at the same level it is a documented
approximation, not a hidden one — an exact cross-severity ordering would need `dueAt`
as a first-class, indexed column on `Incident` itself, which isn't worth adding for a
POC-scale "escalated right now" set.

## Load test (Module 11 hardening)

`scripts/load-test-escalation.ts` (`npm run test:load`) boots its own throwaway
Testcontainers Postgres, seeds 5,000 unacknowledged HIGH/CRITICAL incidents with
staggered `highSeveritySince` offsets (0–299 minutes before the frozen "now", cycling
through every combination of which of L1/L2/L3 is already due) plus 500 already
acknowledged/CLOSED HIGH/CRITICAL rows the job must never touch, then runs the job four
times: once cold, once immediately after (idempotency), and a final pair fired via
`Promise.all` (simulating a double-click on Admin's **[Run now]**). Expected event
counts are computed independently via the job's own pure `tiersDueFor`, so a pass means
the actual `EscalationEvent`/`NotificationLog` row counts match a derivation that never
touched the job's SQL.

**Measured** (2026-09-18, this machine, Postgres 16 in a local Testcontainers
container — wall-clock, not a production SLA):

| Run | Outcome | Scanned | Escalated | Notified | Wall-clock |
|---|---|---|---|---|---|
| 1 (cold) | COMPLETED | 5,000 | 9,311 | 186,220 | ~73.7s |
| 2 (immediate re-run) | COMPLETED | 5,000 | 0 | 0 | ~157ms |
| 3/4 (concurrent `Promise.all`) | one COMPLETED, one SKIPPED_LOCKED | 5,000 / 0 | 0 / 0 | 0 / 0 | ~221ms combined |

All four runs produced exactly the expected totals, zero events on any excluded
incident, and the concurrent pair never double-escalated — the advisory-lock-claimed
`JobLease` (B3) held under real concurrent load, not just the unit-level lease tests.

**Where the 73.7s actually goes, and why it doesn't matter at this POC's real scale:**
this is a deliberately pathological worst case — 5,000 incidents staggered so that,
summed together, they generate 9,311 individually-due (incident, tier) escalations in
one pass, as if the scheduler had been down for days across the whole fleet at once.
`escalateBatch` processes each due pair with four *sequential* awaited statements
(the conflict-free event insert, the notification fan-out, the audit write, the
counter bump) — a deliberate trade-off, not an oversight: batching the event insert
across the whole due set would still need per-row `ON CONFLICT DO NOTHING` semantics
to preserve exactly-once escalation (B2), and the audit/counter writes are Module 8/4
invariants that must stay one row per event for the timeline to reconstruct correctly.
At ~4 round trips × 9,311 due pairs ≈ 37,000 sequential statements, ~2ms each is where
the time goes. In real operation the job ticks every `ESCALATION_TICK_MS` (60s by
default) and each tick only sees incidents that crossed a *new* threshold since the
last tick — a tiny fraction of 9,311, not the whole backlog at once — so this number is
a genuine worst-case bound on "how long would recovery take after the job was down for
days", not a number that describes any normal run.
