import { IncidentTypeValues } from '../../contracts/enums';
import type {
  AnalyticsOverviewResponse,
  AnalyticsPeriod,
  EscalationPerformanceResponse,
  TrendResponse,
  TypeSeverityMatrixResponse,
} from '../../contracts/analytics.contract';
import type { Severity, IncidentType } from '@prisma/client';
import type { OverviewAggregateRow, EscalationPerformanceRawRow, TrendRawRow } from './analytics.repository';

export function toOverviewResponse(period: AnalyticsPeriod, row: OverviewAggregateRow): AnalyticsOverviewResponse {
  return {
    period,
    totalIncidents: row.total,
    openIncidents: row.open,
    escalatedIncidents: row.escalated,
    medianAckSeconds: row.medianAckSeconds,
  };
}

/**
 * Zero-fills every (type, severity) combination this actor may see — `severities` is
 * `visibleSeverities(actor.clearanceLevel)`, never all four (see the contract's own
 * comment on why an invisible severity must be an OMITTED column, not a fabricated
 * zero). At most `7 types × 4 severities = 28` cells even before clearance narrows it.
 */
export function toMatrixResponse(
  period: AnalyticsPeriod,
  severities: Severity[],
  rows: { type: IncidentType; severity: Severity; count: number }[],
): TypeSeverityMatrixResponse {
  const countByKey = new Map(rows.map((r) => [`${r.type}:${r.severity}`, r.count]));

  const cells = IncidentTypeValues.flatMap((type) =>
    severities.map((severity) => ({ type, severity, count: countByKey.get(`${type}:${severity}`) ?? 0 })),
  );

  const rowTotals = IncidentTypeValues.map((type) => ({
    type,
    count: cells.filter((c) => c.type === type).reduce((sum, c) => sum + c.count, 0),
  }));
  const columnTotals = severities.map((severity) => ({
    severity,
    count: cells.filter((c) => c.severity === severity).reduce((sum, c) => sum + c.count, 0),
  }));
  const grandTotal = rowTotals.reduce((sum, r) => sum + r.count, 0);

  return { period, severities, cells, rowTotals, columnTotals, grandTotal };
}

export function toTrendResponse(period: AnalyticsPeriod, bucket: TrendResponse['bucket'], severities: Severity[], rows: TrendRawRow[]): TrendResponse {
  return {
    period,
    bucket,
    severities,
    points: rows.map((r) => ({ bucketStart: r.bucketStart.toISOString(), severity: r.severity, count: r.count })),
  };
}

export function toEscalationPerformanceResponse(period: AnalyticsPeriod, rows: EscalationPerformanceRawRow[]): EscalationPerformanceResponse {
  return { period, bySeverity: rows };
}

/** `GET /analytics/export.csv` — the matrix, as CSV, one row per (type, severity) plus a trailing total. */
export function toMatrixCsv(matrix: TypeSeverityMatrixResponse): string {
  const lines = ['Type,Severity,Count'];
  for (const cell of matrix.cells) {
    lines.push(`${cell.type},${cell.severity},${cell.count}`);
  }
  lines.push(`TOTAL,,${matrix.grandTotal}`);
  return lines.join('\r\n') + '\r\n';
}
