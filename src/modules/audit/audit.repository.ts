import type { AuditEventType, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { newId } from '../../core/ids';
import type { TxClient } from '../../db/transaction';

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

export function createAuditEvent(input: CreateAuditEventInput, tx: TxClient) {
  return tx.auditEvent.create({
    data: {
      id: newId(),
      incidentId: input.incidentId,
      actorId: input.actorId,
      type: input.type,
      fromValue: input.fromValue,
      toValue: input.toValue,
      reason: input.reason,
      payload: input.payload,
      occurredAt: input.occurredAt,
    },
  });
}

export interface AccessDeniedInput {
  incidentId: string;
  actorId: string;
  reason: string;
  clearanceLevel: number;
  occurredAt: Date;
}

/**
 * Not transactional and not run through auditService.record() on purpose: a refusal
 * has no mutation to be atomic WITH (build-plan.md finding S3 — the same-transaction
 * invariant is real but scoped to mutations). Uses the module-level `prisma` client
 * directly since there is no caller transaction to join.
 */
export function findRecentAccessDenied(actorId: string, incidentId: string, since: Date) {
  return prisma.auditEvent.findFirst({
    where: { type: 'ACCESS_DENIED', actorId, incidentId, occurredAt: { gte: since } },
    select: { id: true },
  });
}

export function createAccessDeniedEvent(input: AccessDeniedInput) {
  return prisma.auditEvent.create({
    data: {
      id: newId(),
      incidentId: input.incidentId,
      actorId: input.actorId,
      type: 'ACCESS_DENIED',
      reason: input.reason,
      payload: { clearanceLevel: input.clearanceLevel },
      occurredAt: input.occurredAt,
    },
  });
}
