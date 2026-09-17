import type { AuditEventType, Prisma } from '@prisma/client';
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
