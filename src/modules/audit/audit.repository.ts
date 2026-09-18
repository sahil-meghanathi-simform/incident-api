import type { AuditEventType, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { newId } from '../../core/ids';
import { occurredAtIdCursorWhere } from '../../core/pagination';
import { USER_REF_SELECT } from '../incidents/incident.repository';
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

// ---------------------------------------------------------------------------
// Module 8 — read side
// ---------------------------------------------------------------------------

export const AUDIT_EVENT_INCLUDE = {
  actor: { select: USER_REF_SELECT },
} satisfies Prisma.AuditEventInclude;

export type AuditEventRow = Prisma.AuditEventGetPayload<{ include: typeof AUDIT_EVENT_INCLUDE }>;

/**
 * The `(incidentId, occurredAt desc, id desc)` index built with the AuditEvent model in
 * Module 0. `includeAccessDenied` is applied HERE, in the WHERE clause, not as a
 * post-fetch filter in the mapper — filtering after the `take` would silently shrink a
 * non-admin's page below `pageSize` (the same class of bug as B1: a scope that isn't
 * composed into the query itself is not really enforced).
 */
export function findTimelinePage(
  incidentId: string,
  cursor: { occurredAt: Date; id: string } | undefined,
  pageSize: number,
  includeAccessDenied: boolean,
): Promise<AuditEventRow[]> {
  const where: Prisma.AuditEventWhereInput = {
    AND: [
      { incidentId },
      ...(includeAccessDenied ? [] : [{ type: { not: 'ACCESS_DENIED' as AuditEventType } }]),
      ...(cursor ? [occurredAtIdCursorWhere(cursor.occurredAt, cursor.id)] : []),
    ],
  };
  return prisma.auditEvent.findMany({
    where,
    include: AUDIT_EVENT_INCLUDE,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
  });
}

/**
 * Batched resolution of the plain-string user ids stored in `fromValue`/`toValue` for
 * INVESTIGATOR_ASSIGNED/UNASSIGNED (that column has no FK — it is reused for every
 * event type's from/to, most of which are enum values, not ids). Called once per page
 * by the mapper, never once per event.
 */
export function findUserRefsByIds(ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.user.findMany({ where: { id: { in: ids } }, select: USER_REF_SELECT });
}

export interface AuditSearchFilters {
  type?: AuditEventType[];
  actorId?: string;
  incidentId?: string;
  from?: Date;
  to?: Date;
}

const AUDIT_SEARCH_INCLUDE = {
  actor: { select: USER_REF_SELECT },
  incident: { select: { reference: true } },
} satisfies Prisma.AuditEventInclude;

export type AuditSearchRow = Prisma.AuditEventGetPayload<{ include: typeof AUDIT_SEARCH_INCLUDE }>;

function buildSearchWhere(filters: AuditSearchFilters): Prisma.AuditEventWhereInput {
  return {
    AND: [
      ...(filters.type && filters.type.length > 0 ? [{ type: { in: filters.type } }] : []),
      ...(filters.actorId ? [{ actorId: filters.actorId }] : []),
      ...(filters.incidentId ? [{ incidentId: filters.incidentId }] : []),
      ...(filters.from ? [{ occurredAt: { gte: filters.from } }] : []),
      ...(filters.to ? [{ occurredAt: { lt: filters.to } }] : []),
    ],
  };
}

/** Global admin search — GET /audit. Same count+findMany transaction shape as incident.repository.ts::countAndFindPage. */
export async function searchAudit(
  filters: AuditSearchFilters,
  page: number,
  pageSize: number,
): Promise<{ items: AuditSearchRow[]; totalItems: number }> {
  const where = buildSearchWhere(filters);
  const [totalItems, items] = await prisma.$transaction([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      include: AUDIT_SEARCH_INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { items, totalItems };
}
