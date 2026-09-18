import type { Request, Response } from 'express';
import type {
  AdminJobRunsQuery,
  AdminUserIdParams,
  AdminUsersQuery,
  ChangeClearanceRequest,
  ChangeRoleRequest,
  ChangeStatusRequest,
  ClearanceImpactQuery,
  TierSetRequest,
} from '../../contracts/admin.contract';
import * as adminService from './admin.service';

export async function listUsersHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AdminUsersQuery;
  const result = await adminService.listUsers(query);
  res.status(200).json(result);
}

export async function clearanceImpactHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as AdminUserIdParams;
  const query = req.validated.query as ClearanceImpactQuery;
  const result = await adminService.previewClearanceImpact(params.id, query.clearanceLevel);
  res.status(200).json(result);
}

export async function changeRoleHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as AdminUserIdParams;
  const body = req.validated.body as ChangeRoleRequest;
  const result = await adminService.changeRole(req.actor!, params.id, body.role);
  res.status(200).json(result);
}

export async function changeClearanceHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as AdminUserIdParams;
  const body = req.validated.body as ChangeClearanceRequest;
  const result = await adminService.changeClearance(req.actor!, params.id, body.clearanceLevel);
  res.status(200).json(result);
}

export async function changeStatusHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as AdminUserIdParams;
  const body = req.validated.body as ChangeStatusRequest;
  const result = await adminService.changeStatus(req.actor!, params.id, body.isActive);
  res.status(200).json(result);
}

export async function getTiersHandler(_req: Request, res: Response): Promise<void> {
  const result = await adminService.listTiers();
  res.status(200).json(result);
}

export async function putTiersHandler(req: Request, res: Response): Promise<void> {
  const body = req.validated.body as TierSetRequest;
  const result = await adminService.putTiers(req.actor!, body);
  res.status(200).json(result);
}

export async function listJobRunsHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as AdminJobRunsQuery;
  const result = await adminService.listJobRuns(query.limit);
  res.status(200).json(result);
}
