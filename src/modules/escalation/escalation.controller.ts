import type { Request, Response } from 'express';
import type { EscalationEventsParams, EscalationFeedQuery } from '../../contracts/escalation.contract';
import * as escalationService from './escalation.service';

export async function tiersHandler(_req: Request, res: Response): Promise<void> {
  const tiers = await escalationService.listTiers();
  res.status(200).json({ tiers });
}

export async function feedHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as EscalationFeedQuery;
  const result = await escalationService.listFeed(req.actor!, query.cursor, query.pageSize);
  res.status(200).json(result);
}

export async function incidentEventsHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as EscalationEventsParams;
  const events = await escalationService.listEventsForIncident(req.actor!, params.incidentId);
  res.status(200).json({ events });
}

export async function runJobHandler(_req: Request, res: Response): Promise<void> {
  const result = await escalationService.runNow();
  res.status(200).json(result);
}
