import type { Request, Response } from 'express';
import type { AssignableInvestigatorQuery } from '../../contracts/user.contract';
import { findAssignableInvestigators } from './users.repository';

export async function assignableInvestigatorsHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AssignableInvestigatorQuery;
  const investigators = await findAssignableInvestigators(query.minClearance ?? 1);
  res.status(200).json(investigators);
}
