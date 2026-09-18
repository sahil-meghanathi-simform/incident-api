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

Every seeded user shares the password `Test@123`. One account per role:

| Email | Role | Clearance |
|---|---|---|
| reporter@yopmail.com | REPORTER | 1 |
| triage_manager@yopmail.com | TRIAGE_MANAGER | 1 |
| investigator@yopmail.com | INVESTIGATOR | 1 |
| admin@yopmail.com | ADMIN | 4 |

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

The spec-mandated proofs live in `tests/scenarios/`, one file per named guarantee:

- `escalation-idempotency.spec.ts` — double runs, concurrent runs, long gaps, the
  ack/escalate race. `scripts/load-test-escalation.ts` (`npm run test:load`) load-tests
  the same job at 5,000 open incidents — see `docs/escalation.md`'s "Load test" section.
- `clearance-by-id.spec.ts` / `clearance-revoked-on-raise.spec.ts` — Q10's by-ID refusal
  and its immediate revocation on a mid-session severity raise.
- `escalation-clearance-scoping.spec.ts` — S2's fix, that the escalation feed and
  notifications are clearance-scoped, not just role-gated.
- `closure-without-rca.spec.ts` — the four-layer RCA-required-to-close proof.
- `severity-change-sweep.spec.ts` / `triage-actions.spec.ts` — the exhaustive
  severity-pair × ack × assignment matrix and the Q17 cascade.
- `investigation-notes.spec.ts` / `timeline.spec.ts` — the two-gate note rule and the
  per-viewer redacted timeline.
- `auth-*.spec.ts` / `users-assignable-investigators.spec.ts` / `admin-users.spec.ts` —
  register/login/refresh-reuse-detection and the admin self-lockout/last-admin/cascade
  rules.

## CI

`.github/workflows/ci.yml`, on every push/PR:

- **`test`** — typecheck, ESLint, `lint:layers`, `npm test` (real Testcontainers
  Postgres — GitHub's `ubuntu-latest` runners ship Docker, so this is the same proof
  `npm test` gives locally, not a mock substituted for CI), and a build.
- **`compose-smoke`** — the real `scripts/smoke-compose.sh` (see Troubleshooting)
  against a fresh checkout of both repos. Needs `incident-web` checked out as a sibling
  directory, and it's a private repo, so this job needs a fine-grained PAT with read
  access to it, stored as this repo's `CROSS_REPO_PAT` secret; it skips cleanly (not a
  failure) if that secret is unset.

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

## Troubleshooting

- **`docker compose up` fails with `ports are not available: ... 0.0.0.0:5432 ...`** —
  something else on the host (commonly a native Postgres install, or an unrelated
  container) already holds port 5432. The compose file's own container always listens
  on 5432 *inside* the Docker network regardless — `api`/`migrate-seed` reach it via
  `DATABASE_URL`'s `postgres:5432` hostname, which is unaffected — only the host-side
  publish needs to move. Set `POSTGRES_HOST_PORT=<free port>` in `.env` (compose reads
  the project-root `.env` for its own `${...}` substitutions, same as the existing
  `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` variables) and re-run.
- **Running `npm run dev`/`prisma migrate dev` outside compose** — point `.env`'s
  `DATABASE_URL` at whatever standalone Postgres you use for that (e.g.
  `localhost:55432` if compose's own 5432 is unavailable per the above), not at the
  `postgres:5432` in-network hostname `.env.example` ships, which only resolves inside
  the compose network.
- `npm run test:compose` (`scripts/smoke-compose.sh`) automates exactly this check —
  full teardown (including volumes) and a fresh `docker compose up --build`, then
  verifies all four services are actually healthy and talking to each other, not just
  that the containers started.
