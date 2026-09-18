import { Prisma, type IncidentType, type Severity, type Stage } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { visibleSeverities } from '../../policy/clearance.policy';
import type { Actor } from '../../types/actor.type';
import type { Bucket } from '../../contracts/analytics.contract';
import type { AnalyticsPeriodFilters } from '../incidents/incident.repository';

/**
 * `prisma.$queryRaw` against `"Incident"`/`"EscalationEvent"` does not match the
 * `prisma\.incident\b` grep `scripts/check-layers.sh` enforces (build-plan.md B1), so
 * this file — unlike every other module reading Incident rows — is allowed to hold its
 * own raw SQL rather than adding functions to incident.repository.ts. The authorization
 * invariant that rule exists to protect is preserved by construction anyway: every query
 * below scopes `severity = ANY(...)` from the SAME `visibleSeverities()` policy function
 * as visibilityScope() (unit-tested in tests/unit/analyticsSeverityArray.spec.ts to
 * produce identical sets for all four clearance levels), never a second, independent
 * notion of "what this actor may see".
 */

/** Exported only for tests/unit/analyticsSeverityArray.spec.ts's Prisma-vs-raw-SQL parity check. */
export function severityArraySql(severities: readonly Severity[]): Prisma.Sql {
  if (severities.length === 0) return Prisma.sql`ARRAY[]::"Severity"[]`;
  return Prisma.sql`ARRAY[${Prisma.join(severities)}]::"Severity"[]`;
}

function typeClauseSql(types: IncidentType[] | undefined): Prisma.Sql {
  if (!types?.length) return Prisma.empty;
  return Prisma.sql`AND i.type = ANY(ARRAY[${Prisma.join(types)}]::"IncidentType"[])`;
}

function stageClauseSql(stages: Stage[] | undefined): Prisma.Sql {
  if (!stages?.length) return Prisma.empty;
  return Prisma.sql`AND i.stage = ANY(ARRAY[${Prisma.join(stages)}]::"Stage"[])`;
}

export interface OverviewAggregateRow {
  total: number;
  open: number;
  escalated: number;
  medianAckSeconds: number | null;
}

/**
 * One query: total/open/escalated counts plus the overall median time-to-acknowledge,
 * all conditional aggregates over a single scan rather than four round trips. `escalated`
 * counts an incident once even if it has multiple EscalationEvent rows (one join per
 * incident via the `first_escalation` CTE, mirroring incident.repository.ts's own
 * "one row per incident, not per event" discipline for the escalation feed).
 */
export async function overviewAggregate(actor: Actor, filters: AnalyticsPeriodFilters): Promise<OverviewAggregateRow> {
  const severities = visibleSeverities(actor.clearanceLevel);
  const rows = await prisma.$queryRaw<{ total: number; open: number; escalated: number; medianAckSeconds: number | string | null }[]>(
    Prisma.sql`
      WITH first_escalation AS (
        SELECT "incidentId", MIN("triggeredAt") AS first_triggered_at
        FROM "EscalationEvent"
        GROUP BY "incidentId"
      )
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE i.stage <> 'CLOSED')::int AS open,
        count(*) FILTER (WHERE fe."incidentId" IS NOT NULL)::int AS escalated,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (i."acknowledgedAt" - fe.first_triggered_at))
        ) FILTER (WHERE i."acknowledgedAt" IS NOT NULL AND fe."incidentId" IS NOT NULL) AS "medianAckSeconds"
      FROM "Incident" i
      LEFT JOIN first_escalation fe ON fe."incidentId" = i.id
      WHERE i."createdAt" >= ${filters.from} AND i."createdAt" < ${filters.to}
        AND i.severity = ANY(${severityArraySql(severities)})
        ${typeClauseSql(filters.type)}
        ${stageClauseSql(filters.stage)}
    `,
  );
  const row = rows[0];
  return {
    total: row?.total ?? 0,
    open: row?.open ?? 0,
    escalated: row?.escalated ?? 0,
    medianAckSeconds: row?.medianAckSeconds == null ? null : Number(row.medianAckSeconds),
  };
}

export interface TrendRawRow {
  bucketStart: Date;
  severity: Severity;
  count: number;
}

/**
 * Raw SQL for `date_trunc` (Prisma has no ORM equivalent). Clearance-scoped through
 * `severity = ANY(...)` built by the same `visibleSeverities()` function
 * groupIncidentsByTypeAndSeverity uses, and the SAME half-open `[from, to)` bound
 * (computed once in analytics.service.ts) — the two disagreeing was build-plan.md's S4.
 */
export async function trendAggregate(actor: Actor, filters: AnalyticsPeriodFilters, bucket: Bucket): Promise<TrendRawRow[]> {
  const severities = visibleSeverities(actor.clearanceLevel);
  const rows = await prisma.$queryRaw<{ bucketStart: Date; severity: Severity; count: number }[]>(
    Prisma.sql`
      SELECT date_trunc(${bucket}, i."createdAt") AS "bucketStart", i.severity AS severity, count(*)::int AS count
      FROM "Incident" i
      WHERE i."createdAt" >= ${filters.from} AND i."createdAt" < ${filters.to}
        AND i.severity = ANY(${severityArraySql(severities)})
        ${typeClauseSql(filters.type)}
        ${stageClauseSql(filters.stage)}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
  );
  return rows;
}

export interface EscalationPerformanceRawRow {
  severity: Severity;
  escalatedCount: number;
  acknowledgedCount: number;
  medianAckSeconds: number | null;
  p90AckSeconds: number | null;
}

/**
 * build-plan.md S2: the reference plan scoped overview/by-type-severity/trend by
 * clearance but not this endpoint, even though it joins EscalationEvent to Incident —
 * an incident read like any other. The `JOIN` (not `LEFT JOIN`) to `first_escalation`
 * is deliberate: this endpoint reports on incidents that DID escalate, unlike overview's
 * `escalated` count which needs the LEFT JOIN to also see never-escalated incidents.
 */
export async function escalationPerformanceAggregate(
  actor: Actor,
  filters: AnalyticsPeriodFilters,
): Promise<EscalationPerformanceRawRow[]> {
  const severities = visibleSeverities(actor.clearanceLevel);
  const rows = await prisma.$queryRaw<
    { severity: Severity; escalatedCount: number; acknowledgedCount: number; medianAckSeconds: number | string | null; p90AckSeconds: number | string | null }[]
  >(
    Prisma.sql`
      WITH first_escalation AS (
        SELECT "incidentId", MIN("triggeredAt") AS first_triggered_at
        FROM "EscalationEvent"
        GROUP BY "incidentId"
      )
      SELECT
        i.severity AS severity,
        count(*)::int AS "escalatedCount",
        count(*) FILTER (WHERE i."acknowledgedAt" IS NOT NULL)::int AS "acknowledgedCount",
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (i."acknowledgedAt" - fe.first_triggered_at))
        ) FILTER (WHERE i."acknowledgedAt" IS NOT NULL) AS "medianAckSeconds",
        percentile_cont(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (i."acknowledgedAt" - fe.first_triggered_at))
        ) FILTER (WHERE i."acknowledgedAt" IS NOT NULL) AS "p90AckSeconds"
      FROM "Incident" i
      JOIN first_escalation fe ON fe."incidentId" = i.id
      WHERE i."createdAt" >= ${filters.from} AND i."createdAt" < ${filters.to}
        AND i.severity = ANY(${severityArraySql(severities)})
        ${typeClauseSql(filters.type)}
        ${stageClauseSql(filters.stage)}
      GROUP BY i.severity
      ORDER BY i.severity
    `,
  );
  return rows.map((r) => ({
    severity: r.severity,
    escalatedCount: r.escalatedCount,
    acknowledgedCount: r.acknowledgedCount,
    medianAckSeconds: r.medianAckSeconds == null ? null : Number(r.medianAckSeconds),
    p90AckSeconds: r.p90AckSeconds == null ? null : Number(r.p90AckSeconds),
  }));
}
