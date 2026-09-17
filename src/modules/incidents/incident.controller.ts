import type { Request, Response } from 'express';
import type { CreateIncidentRequest } from '../../contracts/incident.contract';
import * as incidentService from './incident.service';

export async function createHandler(req: Request, res: Response): Promise<void> {
  const body = req.validated.body as CreateIncidentRequest;
  const receipt = await incidentService.create(req.actor!, body);
  res.status(201).location(`/api/v1/incidents/${receipt.id}`).json(receipt);
}

export async function typesHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(incidentService.typesForForm());
}
