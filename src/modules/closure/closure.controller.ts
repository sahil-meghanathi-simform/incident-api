import type { Request, Response } from 'express';
import type { IncidentIdParams } from '../../contracts/incident.contract';
import type { ClosuresPendingQuery, ProposeClosureRequest, RejectClosureRequest } from '../../contracts/closure.contract';
import * as closureService from './closure.service';

// req.ifMatchVersion is guaranteed to be set here — ifMatch.middleware.ts runs before
// every one of these handlers and rejects the request itself (422) if it is absent.
function requiredVersion(req: Request): number {
  return req.ifMatchVersion as number;
}

export async function proposeClosureHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const body = req.validated.body as ProposeClosureRequest;
  const result = await closureService.propose(req.actor!, params.id, body, requiredVersion(req));
  res.status(200).json(result);
}

export async function approveClosureHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const result = await closureService.approve(req.actor!, params.id, requiredVersion(req));
  res.status(200).json(result);
}

export async function rejectClosureHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const body = req.validated.body as RejectClosureRequest;
  const result = await closureService.reject(req.actor!, params.id, body.reason, requiredVersion(req));
  res.status(200).json(result);
}

export async function closuresPendingHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as ClosuresPendingQuery;
  const result = await closureService.getClosuresPending(req.actor!, query.page, query.pageSize);
  res.status(200).json(result);
}
