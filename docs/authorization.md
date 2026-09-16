# Authorization model

## The single scope fragment

`src/policy/clearance.policy.ts::visibilityScope(actor)` is the only function that
decides "which incidents may this actor read at all". Every incident read — list,
by-ID, `/mine`, summary, notes, escalations, notifications, analytics — composes it via
an explicit `AND: [...]` array, never by object-spreading it alongside another filter.

This is not a style preference. The reference `implementation-plan.md` spread
`visibilityScope(actor)` (`{ severity: { in: [...] } }`) and a caller-supplied severity
filter on the *same key*, and JS object spread overwrites duplicate keys — silently
deleting the scope. A clearance-1 user requesting `?severity=CRITICAL` would have read
every CRITICAL incident in the database. See `../build-plan.md` finding B1 and
`tests/unit/clearance.policy.spec.ts::effectiveSeverities`.

## By-ID refusal (walkthrough question 3)

`incident.repository.ts::getByIdForActor` (Module 3) makes the authorization decision
with ONE scoped query (`{ id, ...visibilityScope(actor) }` composed via `AND`). A
second query, used only to choose 403 vs 404, selects nothing but the id and cannot
grant anything.

## The two-gate note rule (walkthrough question 2)

Investigation notes require BOTH clearance (can the actor see the incident at all) and
assignment (are they the assigned investigator, or Admin). Both gates are expressed in
`investigation.repository.ts`'s `where` clause on the related incident, not only in
`policy/note.policy.ts` — so a wrong actor gets zero rows even if a controller check
were bypassed.

## Immediate revocation (Q10)

Every read re-evaluates against *current* severity — there is no cached or
point-in-time snapshot of what a user was allowed to see. A user with an incident open
loses it on their very next request after its severity is raised past their clearance.
This extends to surfaces the reference plan did not identify as incident reads: the
escalation feed and notifications list are both joined through `visibilityScope` (see
build-plan.md finding S2), so a clearance change is reflected there too, not just on
the incident detail screen.

## Clearance is re-read from the database on every request (Q8b)

`http/middleware/authenticate.middleware.ts` looks up `role` + `clearanceLevel` by
primary key on every authenticated request — never from the JWT payload, which carries
only `{ sub, sid }`. This one indexed PK lookup is the entire mechanism behind both Q8b
(a clearance change is effective on the very next request, no re-login) and Q10.
