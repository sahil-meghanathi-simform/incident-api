# Query plans

`EXPLAIN (ANALYZE, BUFFERS)` output for the queries this POC is asked to "be ready to
explain the cost of" (§3.7). Populated as each module's real queries land against the
5,000-incident seeded dataset — Module 3 (incident list, by-ID), Module 7 (escalation
candidate scan), Module 9 (analytics matrix/trend).

Status: Module 9 filled in below, against the real ~5,000-incident seeded dataset
(`incident-poc-devdb`, host port 55432 — see the incident-poc-project memory's Module
1/7 local-dev notes). Module 3 (incident list, by-ID) and Module 7 (escalation
candidate scan) are still pending — this file was never backfilled for them and that
gap is real, not silently hidden.

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
