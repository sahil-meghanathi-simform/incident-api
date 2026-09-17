import type { Request, Response } from 'express';
import type { NotificationIdParams, NotificationsQuery } from '../../contracts/escalation.contract';
import * as notificationService from './notification.service';

export async function listNotificationsHandler(req: Request, res: Response): Promise<void> {
  const query = req.validated.query as NotificationsQuery;
  const result = await notificationService.listNotifications(req.actor!, query.cursor, query.pageSize);
  res.status(200).json(result);
}

export async function markNotificationReadHandler(req: Request, res: Response): Promise<void> {
  const params = req.validated.params as NotificationIdParams;
  const result = await notificationService.markNotificationRead(req.actor!, params.id);
  res.status(200).json(result);
}
