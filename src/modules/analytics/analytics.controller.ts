import type { Request, Response } from 'express';
import type {
  AnalyticsEscalationPerformanceQuery,
  AnalyticsMatrixQuery,
  AnalyticsOverviewQuery,
  AnalyticsTrendQuery,
} from '../../contracts/analytics.contract';
import * as analyticsService from './analytics.service';

export async function overviewHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AnalyticsOverviewQuery;
  const result = await analyticsService.overview(req.actor!, query);
  res.status(200).json(result);
}

export async function matrixHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AnalyticsMatrixQuery;
  const result = await analyticsService.matrix(req.actor!, query);
  res.status(200).json(result);
}

export async function trendHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AnalyticsTrendQuery;
  const result = await analyticsService.trend(req.actor!, query);
  res.status(200).json(result);
}

export async function escalationPerformanceHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AnalyticsEscalationPerformanceQuery;
  const result = await analyticsService.escalationPerformance(req.actor!, query);
  res.status(200).json(result);
}

/**
 * Plain buffered text, not a real stream (build-plan.md: decorative at ≤28 rows).
 * `Content-Disposition: attachment` is what makes the browser's Blob-URL download
 * (`ExportCsvButton`, see docs/decisions.md) save a file instead of navigating to it.
 */
export async function exportCsvHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AnalyticsMatrixQuery;
  const csv = await analyticsService.exportCsv(req.actor!, query);
  res
    .status(200)
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="incident-analytics-${query.from}-to-${query.to}.csv"`)
    .send(csv);
}
