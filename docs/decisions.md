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

## `/analytics/export.csv` cannot be a plain link (Module 9)

The reference plan's flow diagram shows `[Export CSV]` as a browser download, but the
access token is deliberately in-memory (Module 1's decision) — `<a href="...">`,
`<a download>` and `window.open` all navigate with no `Authorization` header, so any of
them would 401 against this endpoint. `ExportCsvButton` must `fetch()` the URL with the
header itself, turn the response into a `Blob`, and click a synthetic `<a>` pointed at
`URL.createObjectURL(blob)`. Separately, the reference plan's "streams with a cursor"
claim for this endpoint is decorative at its actual size (≤28 rows, the same matrix the
JSON endpoint already returns in one query) — it is a small buffered CSV string, not a
real streamed response, and this file says so rather than leaving the claim standing.

## `ErrorCodeSchema` was missing five codes actually thrown in practice (Module 11)

Found while writing `docs/api.md`'s per-endpoint error-code reference from the
contracts: `src/contracts/errors.contract.ts::ErrorCodeValues` never included
`SEVERITY_UNCHANGED`, `INVALID_ASSIGNMENT_TARGET`, `NO_INVESTIGATOR_ASSIGNED`,
`INCIDENT_CLOSED`, or `EMAIL_ALREADY_EXISTS`, even though every one of them is thrown
by a real service path (`src/core/errors/domain-errors.ts`, `http-errors.ts`) and has
been since the module that introduced it. Harmless at runtime — `error.middleware.ts`
serializes `err.code` directly, and neither this backend nor `incident-web`'s
`api/client.ts` ever calls `ErrorCodeSchema`/`ErrorEnvelopeSchema.parse()` against a
real response — but it made the schema, and any future code that trusted it as
exhaustive, wrong. Fixed by adding the five codes and propagating through the normal
`contracts:export` → `contracts:sync` → `contracts:check` path; both test suites and
both typechecks stayed green, confirming nothing depended on the enum being narrower.

## The logout→different-user-login identity race (Module 10 finding, root-caused and fixed in Module 11)

Module 10's own verification flagged, but did not root-cause, a bug: logging out and
immediately logging back in as a different user — fast enough to require scripted
clicks, not ordinary typing speed — could leave the topbar/SideNav showing the
PREVIOUS user's identity and permissions, even though routing correctly landed on the
new user's role home. Root-caused this module via direct React fiber inspection
against a live repro (not guesswork): `useLogin`'s `onSuccess` wrote the new user with
`queryClient.setQueryData(queryKeys.session, data.user)` — a direct, synchronous cache
write. Reading the cache immediately afterward (`queryClient.getQueryData`) always
showed the correct new user, from the exact same `QueryClient` instance the mounted
tree uses (verified by walking the live fiber tree to the same object) — but
`AuthProvider`'s already-mounted `useSession()` `useQuery` observer's OWN React state
(`fiber.memoizedState.data`, read directly) stayed on the previous user indefinitely,
with nothing ever bringing it up to date short of a full page reload. Calling that
same observer's `refetch()` directly (also via the live fiber) updated it correctly on
the spot — proving the observer was alive, correctly subscribed, and perfectly capable
of updating, just never notified by the bare `setQueryData` write specifically. The
exact TanStack Query internal reason `setQueryData`'s notify path didn't reach this
observer, while an explicit `refetch()` always did, was not further isolated — it
wasn't necessary to, once a mechanism that reliably works was in hand.

**Fix:** `useLogin`'s `onSuccess` and `useLogout`'s `onSettled` both now call
`queryClient.invalidateQueries({ queryKey: queryKeys.session })` instead of writing the
cache directly — `invalidateQueries` drives the SAME observer through a real fetch
cycle (`query.fetch()`, which itself cancels any superseded in-flight retryer via
`retryer.cancel({revert:true})` before starting — see `query-core/src/retryer.ts`'s
`resolve`/`reject`, which permanently no-op once `isResolved()` is true), which is the
path proven to update reliably. `useLogout` invalidates BEFORE `queryClient.clear()`
(not after) specifically so there is still a `Query` object for it to act on;
`useLogin` needs no such ordering since `setAccessToken` has already run, so the
resulting refetch calls the real `/me` with the new user's credentials — authoritative,
not a re-derivation of the login response.

**Verified live**, not just by test: real Chrome automation against the dev servers,
three back-to-back fast logout→different-user-login cycles (reporter→admin,
admin→reporter, reporter→admin again, ~300–500ms between logout and the next login's
submit), each checked via the DOM's actual text content (not a screenshot) immediately
after — correct every time, both directions. `tests/features/auth/hooks/
sessionSync.spec.tsx` (new) mounts a REAL `useSession()` observer alongside
`useLogin`/`useLogout` — unlike a bare `queryClient.setQueryData`/`getQueryData` probe,
this is the one test shape that actually exercises the broken notification path; it
fails against the old `setQueryData`-based code (confirmed by temporarily reverting the
fix and re-running it) and passes with the fix.

## The escalation job does not seed history

`prisma/seed/incidents.seed.ts` deliberately does not write `EscalationEvent`/
`NotificationLog` rows for the ~5,000 seeded incidents, even though many are seeded as
unacknowledged HIGH/CRITICAL. Doing so correctly requires back-filling
`currentEscalationLevel` to match the seeded history exactly, and getting that
back-fill wrong reintroduces the exact "counter disagrees with history" bug the job's
own idempotency is tested against. The live scheduler picks up every eligible seeded
incident and escalates it for real within one tick of `docker compose up`.
