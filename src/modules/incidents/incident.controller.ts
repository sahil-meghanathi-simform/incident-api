import type { Request, Response } from 'express';
import type { CreateIncidentRequest, IncidentIdParams, ListIncidentsQuery, MineQuery } from '../../contracts/incident.contract';
import * as incidentService from './incident.service';

export async function createHandler(req: Request, res: Response): Promise<void> {
  const body = req.validated.body as CreateIncidentRequest;
  const receipt = await incidentService.create(req.actor!, body, req.file);
  res.status(201).location(`/api/v1/incidents/${receipt.id}`).json(receipt);
}

export async function typesHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(incidentService.typesForForm());
}

export async function listHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as ListIncidentsQuery;
  const page = await incidentService.list(req.actor!, query);
  res.status(200).json(page);
}

export async function getByIdHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const incident = await incidentService.getById(req.actor!, params.id);
  res.status(200).json(incident);
}

export async function mineHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as MineQuery;
  const page = await incidentService.mine(req.actor!, query.page, query.pageSize);
  res.status(200).json(page);
}

export async function summaryHandler(req: Request, res: Response): Promise<void> {
  const result = await incidentService.summary(req.actor!);
  res.status(200).json(result);
}
