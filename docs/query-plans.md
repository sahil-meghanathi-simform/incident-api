# Query plans

`EXPLAIN (ANALYZE, BUFFERS)` output for the queries this POC is asked to "be ready to
explain the cost of" (§3.7). Populated as each module's real queries land against the
5,000-incident seeded dataset — Module 3 (incident list, by-ID), Module 7 (escalation
candidate scan), Module 9 (analytics matrix/trend).

Status: complete. Module 9's three queries, Module 3's list/by-ID, and Module 7's
escalation-candidate scan are all below, run against the real ~5,000-incident seeded
dataset (`incident-poc-devdb`, host port 55432 — see the incident-poc-project memory's
Module 1/7 local-dev notes; 5,002 rows at the time these plans were captured, the extra
two being Module 10's ad-hoc `INC-M10-*` fixtures).

## Module 3 — Read & Visibility

### `GET /incidents` — the list

`countAndFindPage` (`incident.repository.ts`) runs a `count` and a `findMany` in one
`$transaction` so the total and the page can never disagree. Both below use an ADMIN
actor (clearance 4 — `visibilityScope` widens to all four severities, the broadest and
most expensive case; a narrower clearance only shrinks the `ANY(...)` array) with no
caller filters, the default `ORDER BY "createdAt" DESC`, page 1 of the default
`pageSize` (25).

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM "Incident"
WHERE severity = ANY(ARRAY['LOW','MEDIUM','HIGH','CRITICAL']::"Severity"[]);
```

```
Aggregate  (actual time=0.730..0.731 rows=1 loops=1)
  Buffers: shared hit=147
  ->  Index Only Scan using "Incident_severity_stage_createdAt_idx" on "Incident"
        (actual time=0.027..0.506 rows=5002 loops=1)
        Index Cond: (severity = ANY ('{LOW,MEDIUM,HIGH,CRITICAL}'::"Severity"[]))
        Heap Fetches: 138
Planning Time: 0.414 ms
Execution Time: 0.755 ms
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, reference, type, severity, stage, title, "createdAt"
FROM "Incident"
WHERE severity = ANY(ARRAY['LOW','MEDIUM','HIGH','CRITICAL']::"Severity"[])
ORDER BY "createdAt" DESC
LIMIT 25 OFFSET 0;
```

```
Limit  (actual time=0.012..0.054 rows=25 loops=1)
  Buffers: shared hit=24
  ->  Index Scan using "Incident_createdAt_id_idx" on "Incident"
        (actual time=0.011..0.051 rows=25 loops=1)
        Filter: (severity = ANY ('{LOW,MEDIUM,HIGH,CRITICAL}'::"Severity"[]))
        Buffers: shared hit=24
Planning Time: 0.156 ms
Execution Time: 0.065 ms
```

The count is an index-only scan on `(severity, stage, createdAt)` (visits every
matching row to count it — unavoidable for an exact total, still under 1ms at this
scale); the page itself is a plain `LIMIT`-bounded index scan on
`(createdAt DESC, id DESC)`, filtering `severity` on the way past rather than seeking
on it, since `createdAt DESC` is the requested order and the filter only needs to
reject 0 of 25 rows at ADMIN clearance. A narrower clearance (fewer severities in the
`ANY(...)` array) makes the filter reject more rows per page but never changes which
index is used — Module 3's own `q`/`stage`/`type`/date-range filters each add one more
`AND` entry that the planner combines with the same index or falls back to a Bitmap
Heap Scan for, never a full table scan, since every filterable column has a
supporting index (`prisma/schema.prisma`'s five `@@index` entries on `Incident`).

### `GET /incidents/:id`

`findByIdScoped` — one query, `{ id, severity: { in: visibleSeverities(...) } }` — is
the entire authorization decision (§2.3); the second query (`existsById`, chosen only
to decide 403 vs 404) selects nothing but `id` and is a trivial primary-key lookup, not
worth its own plan.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "Incident"
WHERE id = '<a real CRITICAL incident id>'
  AND severity = ANY(ARRAY['LOW','MEDIUM','HIGH','CRITICAL']::"Severity"[])
LIMIT 1;
```

```
Limit  (actual time=0.020..0.021 rows=1 loops=1)
  Buffers: shared hit=3
  ->  Index Scan using "Incident_pkey" on "Incident"  (actual time=0.020..0.020 rows=1 loops=1)
        Index Cond: (id = '<id>'::text)
        Filter: (severity = ANY ('{LOW,MEDIUM,HIGH,CRITICAL}'::"Severity"[]))
Planning Time: 0.517 ms
Execution Time: 0.043 ms
```

Primary-key index scan, `severity` re-checked as a filter on the one fetched row — the
clearance check costs nothing extra beyond the PK lookup itself, at any scale, because
it never has to search for the row: it only has to accept or reject the one row the PK
already found. This is why a clearance-1 actor's 403 on a CRITICAL incident is exactly
as fast as an ADMIN's 200 on the same row.

## Module 7 — Escalation

### The job's candidate scan (`escalation.job.ts`)

Each batch iteration re-runs this `WHERE` (widened by an `OR` cursor entry on every
call after the first — omitted below for the first-batch case, which is also the most
expensive since it has no cursor to seek on):

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, severity, "highSeveritySince", "escalationCycle", "currentEscalationLevel"
FROM "Incident"
WHERE "acknowledgedAt" IS NULL
  AND stage <> 'CLOSED'
  AND severity = ANY(ARRAY['HIGH','CRITICAL']::"Severity"[])
  AND "highSeveritySince" IS NOT NULL
ORDER BY "highSeveritySince" ASC, id ASC
LIMIT 500;
```

```
Limit  (actual time=2.109..2.203 rows=500 loops=1)
  Buffers: shared hit=172
  ->  Sort  (actual time=2.107..2.144 rows=500 loops=1)
        Sort Key: "highSeveritySince", id
        ->  Bitmap Heap Scan on "Incident"  (actual time=0.182..1.621 rows=839 loops=1)
              Recheck Cond: (("highSeveritySince" IS NOT NULL) AND ("acknowledgedAt" IS NULL)
                              AND (stage <> 'CLOSED'::"Stage")
                              AND (severity = ANY ('{HIGH,CRITICAL}'::"Severity"[])))
              Heap Blocks: exact=156
              ->  Bitmap Index Scan on incident_escalation_candidates
                    (actual time=0.139..0.139 rows=843 loops=1)
                    Index Cond: ("highSeveritySince" IS NOT NULL)
Planning Time: 1.357 ms
Execution Time: 2.291 ms
```

`incident_escalation_candidates` is a **partial** index —
`("highSeveritySince", id) WHERE "acknowledgedAt" IS NULL AND stage <> 'CLOSED' AND
severity = ANY('{HIGH,CRITICAL}')` — so its size tracks the number of incidents
actually eligible for escalation (839 of the seed's 5,002 rows), never the whole
table, and it bakes in three of the scan's four predicates for free; only
`"highSeveritySince" IS NOT NULL` shows up as an explicit index condition because the
other three are already baked into the index's own `WHERE`, not because they were
skipped. 2.3ms for the first (uncursored, most expensive) batch of 500 at 5,002 total
rows and 839 eligible ones — see "Load test" in `docs/escalation.md` for the job's
end-to-end behavior across a full scan and repeated quick-succession runs at this
scale.

## Module 9 — Reporting & Analytics

All three queries below ran with `from = 2026-03-21` (the seed's earliest `createdAt`),
`to = 2026-09-18` (the day after its latest), and `severity = ANY('{LOW,MEDIUM,HIGH,CRITICAL}')`
— an ADMIN's clearance-4 view, i.e. the widest and most expensive case; a narrower
clearance only shrinks the `ANY(...)` array and therefore the row count. Bind
parameters are written as literals below for readability; the application always
passes them as real bound parameters via `Prisma.sql`/`Prisma.join`
(analytics.repository.ts), never string-interpolated.

### `GET /analytics/by-type-severity` — the matrix

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT type, severity, count(*)::int AS count
FROM "Incident"
WHERE "createdAt" >= '2026-03-21' AND "createdAt" < '2026-09-18'
  AND severity = ANY(ARRAY['LOW','MEDIUM','HIGH','CRITICAL']::"Severity"[])
GROUP BY type, severity;
```

```
GroupAggregate  (actual time=0.060..1.010 rows=28 loops=1)
  Group Key: type, severity
  Buffers: shared hit=101 dirtied=1
  ->  Index Only Scan using "Incident_type_severity_createdAt_idx" on "Incident"
        (actual time=0.015..0.685 rows=5000 loops=1)
        Index Cond: ("createdAt" >= '2026-03-21' AND "createdAt" < '2026-09-18')
        Filter: (severity = ANY ('{LOW,MEDIUM,HIGH,CRITICAL}'::"Severity"[]))
        Heap Fetches: 104
Planning Time: 0.518 ms
Execution Time: 1.030 ms
```

Index-only scan on the `(type, severity, createdAt)` index added specifically for this
query (schema.prisma's own "analytics group-by" comment) — the whole 5,000-row range
is fully cached (101 buffer hits, zero real I/O) and the group-by itself is ~1ms. This
query never filters `type`, so the planner used the index only for the `createdAt`
bound and re-checked `severity` as a filter on the index tuple, rather than pruning on
all three columns — still fast enough at this scale that it doesn't matter, but worth
knowing if the dataset grows by orders of magnitude and `type` becomes the selective
predicate instead (matrix cell clicks filter by exactly `type` + `severity`, so a
future `(type, severity)`-only covering index would help that read path, not this one).

### `GET /analytics/trend`

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT date_trunc('week', i."createdAt") AS bucket, i.severity, count(*)::int AS count
FROM "Incident" i
WHERE i."createdAt" >= '2026-03-21' AND i."createdAt" < '2026-09-18'
  AND i.severity = ANY(ARRAY['LOW','MEDIUM','HIGH','CRITICAL']::"Severity"[])
GROUP BY 1, 2 ORDER BY 1, 2;
```

```
Sort  (actual time=1.584..1.589 rows=108 loops=1)
  Sort Key: (date_trunc('week', "createdAt")), severity
  ->  HashAggregate  (actual time=1.533..1.546 rows=108 loops=1)
        Group Key: date_trunc('week', "createdAt"), severity
        ->  Index Only Scan using "Incident_severity_stage_createdAt_idx" on "Incident" i
              (actual time=0.020..1.007 rows=5000 loops=1)
              Index Cond: (severity = ANY (...) AND "createdAt" >= '2026-03-21' AND "createdAt" < '2026-09-18')
              Heap Fetches: 104
Planning Time: 0.461 ms
Execution Time: 1.643 ms
```

Here the planner used `(severity, stage, createdAt)` instead — `severity`'s `ANY(...)`
array is the leading column, so the whole predicate (including the `createdAt` range)
becomes a genuine index condition, with `stage` skipped over since it's unconstrained.
`date_trunc`'s own hash-then-sort costs under 1ms on top of the scan. This is the same
half-open `[from, to)` bound as the matrix query above (both computed once by
analytics.service.ts's `toFilters`, never re-derived — the actual fix for build-plan.md
S4, proven directly by `tests/integration/analytics.spec.ts`'s boundary test).

### `GET /analytics/escalation-performance`

```sql
EXPLAIN (ANALYZE, BUFFERS)
WITH first_escalation AS (
  SELECT "incidentId", MIN("triggeredAt") AS first_triggered_at
  FROM "EscalationEvent" GROUP BY "incidentId"
)
SELECT i.severity, count(*)::int AS "escalatedCount",
       count(*) FILTER (WHERE i."acknowledgedAt" IS NOT NULL)::int AS "acknowledgedCount",
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i."acknowledgedAt" - fe.first_triggered_at)))
         FILTER (WHERE i."acknowledgedAt" IS NOT NULL) AS "medianAckSeconds"
FROM "Incident" i
JOIN first_escalation fe ON fe."incidentId" = i.id
WHERE i."createdAt" >= '2026-03-21' AND i."createdAt" < '2026-09-18'
  AND i.severity = ANY(ARRAY['LOW','MEDIUM','HIGH','CRITICAL']::"Severity"[])
GROUP BY i.severity ORDER BY i.severity;
```

```
GroupAggregate  (actual time=2.910..2.986 rows=2 loops=1)
  ->  Sort (actual time=2.862..2.895 rows=838 loops=1)
        ->  Hash Join  (actual time=0.932..2.746 rows=838 loops=1)
              Hash Cond: (i.id = fe."incidentId")
              ->  Seq Scan on "Incident" i  (actual time=0.007..1.347 rows=5000 loops=1)
                    Filter: ("createdAt" range AND severity = ANY(...))
              ->  Hash (actual time=0.918..0.918 rows=838 loops=1)
                    ->  Subquery Scan on fe (actual time=0.693..0.819 rows=838 loops=1)
                          ->  HashAggregate (actual time=0.692..0.754 rows=838 loops=1)
                                ->  Seq Scan on "EscalationEvent" (actual time=0.004..0.217 rows=2514 loops=1)
Planning Time: 0.693 ms
Execution Time: 3.055 ms
```

A `Seq Scan` on `Incident`, not an index scan — correctly, since the `createdAt` range
covers essentially the entire 5,000-row seed and there is no `type`/`stage` filter here
to narrow it, so scanning sequentially and filtering is cheaper than an index round
trip per row. Still 3ms end to end including the `EscalationEvent` aggregation
(2,514 rows) and the join. This is the join build-plan.md's S2 finding required be
scoped by `severity = ANY(...)` — the reference plan omitted it entirely for this one
endpoint while scoping the other three.
