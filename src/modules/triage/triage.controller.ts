import type { Request, Response } from 'express';
import type { IncidentIdParams } from '../../contracts/incident.contract';
import type { AssignInvestigatorRequest, ChangeSeverityRequest, TriageQueueQuery } from '../../contracts/triage.contract';
import * as triageService from './triage.service';

// req.ifMatchVersion is guaranteed to be set here — ifMatch.middleware.ts runs before
// every one of these handlers and rejects the request itself (422) if it is absent.
function requiredVersion(req: Request): number {
  return req.ifMatchVersion as number;
}

export async function triageHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const result = await triageService.triage(req.actor!, params.id, requiredVersion(req));
  res.status(200).json(result);
}

export async function changeSeverityHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const body = req.validated.body as ChangeSeverityRequest;
  const result = await triageService.changeSeverity(req.actor!, params.id, body, requiredVersion(req));
  res.status(200).json(result);
}

export async function assignInvestigatorHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const body = req.validated.body as AssignInvestigatorRequest;
  const result = await triageService.assignInvestigator(req.actor!, params.id, body.investigatorId, requiredVersion(req));
  res.status(200).json(result);
}

export async function unassignInvestigatorHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const result = await triageService.unassignInvestigator(req.actor!, params.id, requiredVersion(req));
  res.status(200).json(result);
}

export async function acknowledgeHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const result = await triageService.acknowledge(req.actor!, params.id, requiredVersion(req));
  res.status(200).json(result);
}

export async function triageQueueHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as TriageQueueQuery;
  const result = await triageService.getTriageQueue(req.actor!, query.page, query.pageSize);
  res.status(200).json(result);
}
