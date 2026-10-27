import type { AuditEventType, Prisma } from '@prisma/client';
import type { AUDIT_EVENT_INCLUDE, AUDIT_SEARCH_INCLUDE } from './audit.repository';

export interface CreateAuditEventInput {
  incidentId?: string;
  actorId?: string;
  type: AuditEventType;
  fromValue?: string;
  toValue?: string;
  reason?: string;
  payload?: Prisma.InputJsonValue;
  occurredAt: Date;
}

export interface AccessDeniedInput {
  incidentId: string;
  actorId: string;
  reason: string;
  clearanceLevel: number;
  occurredAt: Date;
}

export type AuditEventRow = Prisma.AuditEventGetPayload<{ include: typeof AUDIT_EVENT_INCLUDE }>;

export interface AuditSearchFilters {
  type?: AuditEventType[];
  actorId?: string;
  incidentId?: string;
  from?: Date;
  to?: Date;
}

export type AuditSearchRow = Prisma.AuditEventGetPayload<{ include: typeof AUDIT_SEARCH_INCLUDE }>;

export type UserRef = { id: string; displayName: string };
