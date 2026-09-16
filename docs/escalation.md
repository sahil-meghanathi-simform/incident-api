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

## Notifications respect clearance too

Recipients for an escalation are triage managers/admins whose clearance is sufficient
to view the incident's severity — nobody is notified about an incident they could not
open. See `tests/scenarios/escalation-idempotency.spec.ts::"a clearance-2 triage
manager receives no notification..."`.
