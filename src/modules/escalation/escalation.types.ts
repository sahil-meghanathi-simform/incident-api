import type { Prisma } from '@prisma/client';
import type { Severity } from '../../contracts/enums';
import type { NOTIFICATION_INCLUDE } from './notification.repository';

export interface CurrentEventKey {
  incidentId: string;
  cycle: number;
  level: number;
}

export interface CurrentEventRow {
  incidentId: string;
  cycle: number;
  level: number;
  dueAt: Date;
  triggeredAt: Date;
}

export type NotificationRow = Prisma.NotificationLogGetPayload<{ include: typeof NOTIFICATION_INCLUDE }>;

export interface Tier {
  severity: Severity;
  level: number;
  thresholdMinutes: number;
}
