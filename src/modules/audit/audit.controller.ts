import type { Request, Response } from 'express';
import type { IncidentIdParams } from '../../contracts/incident.contract';
import type { AuditSearchQuery, TimelineQuery } from '../../contracts/audit.contract';
import * as auditService from './audit.service';
import * as timelineService from './timeline.service';

export async function timelineHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const query = req.validated.query as TimelineQuery;
  const result = await timelineService.timeline(req.actor!, params.id, query.cursor, query.pageSize);
  res.status(200).json(result);
}

export async function searchAuditHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AuditSearchQuery;
  const result = await auditService.search(query);
  res.status(200).json(result);
}
