# incident-api

Backend for the Incident Reporting & Escalation POC. Express 5 + TypeScript + Prisma +
PostgreSQL 16. Companion frontend: `../incident-web` (sibling checkout, required by
`docker compose up`).

See `../13-incident-reporting-and-escalation.md` (source spec) and `../build-plan.md`
(execution plan, including every corrected mechanism referenced below as B1–B7/S1–S8)
for full context.

## Quick start

```bash
cp .env.example .env
docker compose up
```

That's it — the only manual step is copying `.env.example`. Compose brings up:

1. `postgres` — Postgres 16, healthchecked.
2. `migrate-seed` — one-shot: applies every migration, then seeds users, escalation
   tiers, and ~5,000 incidents. Idempotent — safe to re-run without duplicating data.
3. `api` — this service, on `http://localhost:4000`.
4. `web` — the frontend, on `http://localhost:5173` (requires `../incident-web` to exist
   as a sibling directory).

Verify: `curl http://localhost:4000/api/v1/health` → `{"status":"ok", ...}`.

## Seeded credentials

Every seeded user shares the password `Password123!`. One user per role × clearance
combination, plus a second Admin (so the "last admin cannot be demoted" rule is
demonstrable without locking yourself out):

| Email | Role | Clearance |
|---|---|---|
| reporter1@incident.local | REPORTER | 1 |
| reporter2@incident.local | REPORTER | 2 |
| triage1@incident.local … triage4@incident.local | TRIAGE_MANAGER | 1–4 |
| investigator1@incident.local … investigator4@incident.local | INVESTIGATOR | 1–4 |
| admin1@incident.local, admin2@incident.local | ADMIN | 4 |

## Local development (without compose)

```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev        # tsx watch, http://localhost:4000
```

## Testing

```bash
npm test
```

Integration and scenario tests boot a throwaway Postgres 16 container via
Testcontainers (`tests/setup/globalSetup.ts`) and apply every migration — including the
hand-written CHECK constraints, the composite escalation index, the reference sequence,
and the `JobLease` seed row — before any test runs. `fileParallelism` is disabled: the
advisory lock and the `JobLease` row are database-wide, so parallel test files would
steal each other's lock.

The four spec-mandated proofs live in `tests/scenarios/`:

- `escalation-idempotency.spec.ts` — double runs, concurrent runs, long gaps, the
  ack/escalate race, and (Modules 1–6 TBD) will gain the clearance and closure proofs.

## Known deviations from the reference `implementation-plan.md`

The reference plan's *product* decisions (Q1–Q32) are followed exactly. Its code
samples for two mechanisms were wrong in ways that would have failed the spec's own
§6 checks; both are corrected here and empirically verified against real Postgres
before any dependent module was built. Full detail in `../build-plan.md`:

- **B1** — `buildWhere`'s object spread silently deleted the clearance scope on any
  caller-supplied severity filter. Fixed with an explicit `AND: [...]` composition plus
  `effectiveSeverities()` as a second, independent line of defence.
- **B2** — the escalation job's `catch (isUniqueViolation) { continue }` cannot recover
  from a Postgres unique-constraint violation (Prisma issues no `SAVEPOINT`s, so the
  whole transaction aborts). Fixed with a conflict-free `INSERT ... ON CONFLICT DO
  NOTHING RETURNING id`. Proven in `tests/scenarios/escalation-idempotency.spec.ts` via
  a test that forces the exact disagreement the reference plan's own test never
  exercised (see "is a no-op when currentEscalationLevel disagrees with EscalationEvent
  history").
- **B3** — the run-level guard moved from a transaction-scoped advisory lock (which
  cannot survive a multi-minute scan) to a durable `JobLease` row, claimed via the
  advisory lock in a sub-millisecond transaction; the batched scan runs as many short
  per-batch transactions instead of one long one.
- **B4/B5** — the seed and the incident-creation path both needed
  `incident_reference_seq` (created by hand-written migration) and derived, not
  independently generated, `highSeveritySince`/`rootCause`/`correctiveAction` columns,
  or `docker compose up` fails on a fresh clone.
- **B6/B7** — three Express 5 boot/runtime failures (`req.query` is getter-only, a bare
  `'*'` route throws at boot, the default query parser is `simple`) and two silent
  browser-only failures (`cookie-parser` missing, `If-Match` not CORS-safelisted).
- **S1–S8** — see `../build-plan.md` for the full list (severity-lowering-within-band,
  visibility leaks on the escalation/notification read surfaces, the `ACCESS_DENIED`
  audit write turning a 403 into a 500, cursor/analytics boundary bugs, and more).

## Layering rules

Enforced by both ESLint (`.eslintrc.cjs`) and a CI grep (`npm run lint:layers` →
`scripts/check-layers.sh`), independent of ESLint config drift:

1. `prisma.incident` appears only in `src/modules/incidents/incident.repository.ts`
   (the actor-scoped repository) and `src/jobs/` (the escalation job's system-level
   scan, which is deliberately not actor-scoped — it must see every HIGH/CRITICAL
   incident regardless of any one user's clearance).
2. `req.query` is read only inside `src/http/middleware/validate.middleware.ts`;
   everywhere else reads `req.validated.query`.

## Environment variables

See `.env.example`. All are validated by `src/config/env.ts` (Zod) at process boot —
a missing or malformed value exits before the HTTP listener ever opens.
