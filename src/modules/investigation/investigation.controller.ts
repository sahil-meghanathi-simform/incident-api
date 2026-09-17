import type { Request, Response } from 'express';
import type { IncidentIdParams } from '../../contracts/incident.contract';
import type { AddNoteRequest, MyInvestigationsQuery, NotesCursorQuery } from '../../contracts/investigation.contract';
import * as investigationService from './investigation.service';

export async function listNotesHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const query = req.validated.query as NotesCursorQuery;
  const result = await investigationService.listNotes(req.actor!, params.id, query.cursor, query.pageSize);
  res.status(200).json(result);
}

export async function addNoteHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as IncidentIdParams;
  const body = req.validated.body as AddNoteRequest;
  const result = await investigationService.addNote(req.actor!, params.id, body.body);
  res.status(201).json(result);
}

export async function myInvestigationsHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as MyInvestigationsQuery;
  const result = await investigationService.myInvestigations(req.actor!, query.page, query.pageSize);
  res.status(200).json(result);
}
