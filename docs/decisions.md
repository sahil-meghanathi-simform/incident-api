# Decisions

Source of truth for every "decide and document" the spec (`13-incident-reporting-and-escalation.md`)
calls for. Product decisions Q1–Q32 are recorded in full in `../build-plan.md` §"Decisions
confirmed for this build" and are not repeated here. This file tracks decisions made
*during implementation* that the plan didn't already pin down.

## Severity lowered within the HIGH/CRITICAL band (CRITICAL → HIGH)

Reference plan §9.1 enumerates entering the band, raising within it, and leaving it —
but not lowering *within* it. Decision: the escalation clock (`highSeveritySince`) and
`currentEscalationLevel` are both **preserved** on a within-band lowering. Rationale:
Q19 defines the clock as "the moment the incident entered the HIGH/CRITICAL band" — a
lowering from CRITICAL to HIGH does not leave the band, so the clock should not reset.
Preserving `currentEscalationLevel` means the (now-lower) HIGH tier thresholds do not
re-notify people about escalation levels that were already reached under CRITICAL.
See `src/policy/` (triage severity-change logic, Module 4) and
`tests/unit/...severity...spec.ts` for the exhaustive 12-pair sweep this decision is
tested against.

## Access-denied audit writes are best-effort, not transactional

`ACCESS_DENIED` audit rows (written on a 403 clearance refusal) are explicitly NOT
covered by the "every audit write happens in the same transaction as the state change
it describes" invariant (Module 8) — a refusal describes no state change. They are
fire-and-forget with logging on failure, so a `GET` request's authorization outcome
never depends on whether an audit insert succeeds, and cannot become an unbounded write
under ID-probing.

## `AppError`'s constructor was silently defeating `instanceof` on every subclass

Found while unit-testing the new escalation-feed cursor (Module 7): `AppError`'s
constructor called `Object.setPrototypeOf(this, AppError.prototype)` unconditionally —
a shim needed only when targeting ES5, where a transpiled `class X extends Error`
breaks the prototype chain. This project targets ES2023 (`tsconfig.json`), where native
class extension of a built-in already wires the chain correctly; the shim actively
*undid* it instead, forcing every subclass instance's prototype back to `AppError`
itself. `err instanceof AppError` still worked (that's all `error.middleware.ts` ever
checks), but `err instanceof CursorSortMismatchError` — or any other specific subclass —
silently read `false` for a real instance of it. Nothing in the app had hit this yet
because every existing call site branches on `err.code` (a string), never on the class.
Fixed by removing the line and setting `this.name = new.target.name` instead (so a log
line shows `CursorSortMismatchError`, not the generic `AppError`, for free).

## The escalation job does not seed history

`prisma/seed/incidents.seed.ts` deliberately does not write `EscalationEvent`/
`NotificationLog` rows for the ~5,000 seeded incidents, even though many are seeded as
unacknowledged HIGH/CRITICAL. Doing so correctly requires back-filling
`currentEscalationLevel` to match the seeded history exactly, and getting that
back-fill wrong reintroduces the exact "counter disagrees with history" bug the job's
own idempotency is tested against. The live scheduler picks up every eligible seeded
incident and escalates it for real within one tick of `docker compose up`.
