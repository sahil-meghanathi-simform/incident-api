import { exclusiveEndOfDay } from '../../core/time';
import { visibleSeverities } from '../../policy/clearance.policy';
import type { Actor } from '../../types/actor.type';
import type {
  AnalyticsEscalationPerformanceQuery,
  AnalyticsMatrixQuery,
  AnalyticsOverviewQuery,
  AnalyticsOverviewResponse,
  AnalyticsTrendQuery,
  EscalationPerformanceResponse,
  TrendResponse,
  TypeSeverityMatrixResponse,
} from '../../contracts/analytics.contract';
import { countIncidentsInPeriod, groupIncidentsByTypeAndSeverity, type AnalyticsPeriodFilters } from '../incidents/incident.repository';
import { escalationPerformanceAggregate, overviewAggregate, trendAggregate } from './analytics.repository';
import { toEscalationPerformanceResponse, toMatrixCsv, toMatrixResponse, toOverviewResponse, toTrendResponse } from './analytics.mapper';

/**
 * Every analytics query goes through this one function to build its `[from, to)`
 * bound — `to` is widened via `exclusiveEndOfDay` exactly once, here, and the resulting
 * Date is what every repository function (the Prisma groupBy AND the raw-SQL queries)
 * receives. Nobody downstream re-parses the original `to` string — that discipline is
 * the actual fix for build-plan.md S4 (the reference plan's Prisma path and its trend
 * SQL disagreed on an incident created exactly at `to`).
 */
function toFilters(query: { from: string; to: string; type?: string[]; stage?: string[] }): AnalyticsPeriodFilters {
  return {
    from: new Date(query.from),
    to: exclusiveEndOfDay(query.to),
    type: query.type as AnalyticsPeriodFilters['type'],
    stage: query.stage as AnalyticsPeriodFilters['stage'],
  };
}

export async function overview(actor: Actor, query: AnalyticsOverviewQuery): Promise<AnalyticsOverviewResponse> {
  const filters = toFilters(query);
  const row = await overviewAggregate(actor, filters);
  return toOverviewResponse({ from: query.from, to: query.to }, row);
}

export async function matrix(actor: Actor, query: AnalyticsMatrixQuery): Promise<TypeSeverityMatrixResponse> {
  const filters = toFilters(query);
  const rows = await groupIncidentsByTypeAndSeverity(actor, filters);
  return toMatrixResponse({ from: query.from, to: query.to }, visibleSeverities(actor.clearanceLevel), rows);
}

/** Cross-check the matrix's own totals against an independent `count()` — Module 9's "Done when". */
export async function matrixGrandTotalCrossCheck(actor: Actor, query: AnalyticsMatrixQuery): Promise<number> {
  return countIncidentsInPeriod(actor, toFilters(query));
}

export async function trend(actor: Actor, query: AnalyticsTrendQuery): Promise<TrendResponse> {
  const filters = toFilters(query);
  const rows = await trendAggregate(actor, filters, query.bucket);
  return toTrendResponse({ from: query.from, to: query.to }, query.bucket, visibleSeverities(actor.clearanceLevel), rows);
}

export async function escalationPerformance(
  actor: Actor,
  query: AnalyticsEscalationPerformanceQuery,
): Promise<EscalationPerformanceResponse> {
  const filters = toFilters(query);
  const rows = await escalationPerformanceAggregate(actor, filters);
  return toEscalationPerformanceResponse({ from: query.from, to: query.to }, rows);
}

/**
 * `GET /analytics/export.csv` reuses the matrix's own query (build-plan.md: "at 28 rows,
 * the streaming claim is decorative" — one small buffered response, not a real cursor
 * stream). The frontend cannot use `<a download>`/`window.open` for this (see
 * docs/decisions.md) since the access token is in-memory and neither sends an
 * Authorization header; `ExportCsvButton` must `fetch` this with the header instead.
 */
export async function exportCsv(actor: Actor, query: AnalyticsMatrixQuery): Promise<string> {
  const result = await matrix(actor, query);
  return toMatrixCsv(result);
}
