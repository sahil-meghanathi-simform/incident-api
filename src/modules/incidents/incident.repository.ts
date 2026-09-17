import type { Incident, IncidentType, Prisma, Severity, Stage } from '@prisma/client';
import { prisma } from '../../db/prisma';
import type { TxClient } from '../../db/transaction';
import { effectiveSeverities, visibilityScope } from '../../policy/clearance.policy';
import type { Actor } from '../../types/actor.type';

export interface CreateIncidentInput {
  id: string;
  reference: string;
  type: IncidentType;
  severity: Severity;
  title: string;
  description: string;
  reporterId: string;
  highSeveritySince: Date | null;
  escalationCycle: number;
  createdAt: Date;
}

/**
 * Allocates the next value from `incident_reference_seq` (build-plan.md finding B5)
 * inside the caller's transaction, so a rolled-back creation never burns a reference.
 */
export async function nextReferenceSequence(tx: TxClient): Promise<bigint> {
  const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('incident_reference_seq') AS nextval`;
  const row = rows[0];
  if (!row) throw new Error('incident_reference_seq returned no row');
  return row.nextval;
}

export function createIncident(input: CreateIncidentInput, tx: TxClient): Promise<Incident> {
  return tx.incident.create({
    data: {
      id: input.id,
      reference: input.reference,
      type: input.type,
      severity: input.severity,
      title: input.title,
      description: input.description,
      reporterId: input.reporterId,
      highSeveritySince: input.highSeveritySince,
      escalationCycle: input.escalationCycle,
      createdAt: input.createdAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Module 3 — Read & Visibility
// ---------------------------------------------------------------------------

export interface IncidentListFilters {
  severity?: Severity[];
  stage?: Stage[];
  type?: IncidentType[];
  assignedToMe?: boolean;
  reportedByMe?: boolean;
  unacknowledged?: boolean;
  escalatedOnly?: boolean;
  from?: Date;
  to?: Date; // exclusive upper bound — callers pass the already-widened value
  q?: string;
}

/**
 * The ONLY place a caller-supplied filter is composed with visibilityScope. Every
 * entry is `AND: [...]`, never spread — a spread on the same `severity` key silently
 * DELETES the clearance scope (build-plan.md finding B1; JS object-key semantics, no
 * Prisma AND involved). `effectiveSeverities` is a second, independent line of
 * defence: even if this function's AND composition were ever bypassed, a requested
 * severity above clearance still can't smuggle through it.
 */
export function buildWhere(actor: Actor, filters: IncidentListFilters): Prisma.IncidentWhereInput {
  const and: Prisma.IncidentWhereInput[] = [
    visibilityScope(actor),
    { severity: { in: effectiveSeverities(actor, filters.severity) } },
  ];
  if (filters.stage?.length) and.push({ stage: { in: filters.stage } });
  if (filters.type?.length) and.push({ type: { in: filters.type } });
  if (filters.assignedToMe) and.push({ assignedInvestigatorId: actor.id });
  if (filters.reportedByMe) and.push({ reporterId: actor.id });
  if (filters.unacknowledged) and.push({ acknowledgedAt: null });
  if (filters.escalatedOnly) and.push({ currentEscalationLevel: { gt: 0 } });
  if (filters.from) and.push({ createdAt: { gte: filters.from } });
  if (filters.to) and.push({ createdAt: { lt: filters.to } });
  if (filters.q) {
    // The OR lives inside its own AND entry — composed this way it can never collide
    // with any other filter's OR (S4's failure mode, same root cause as B1).
    and.push({
      OR: [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { reference: { contains: filters.q.toUpperCase() } },
      ],
    });
  }
  return { AND: and };
}

export const USER_REF_SELECT = { id: true, displayName: true } satisfies Prisma.UserSelect;

export const INCIDENT_LIST_INCLUDE = {
  assignee: { select: USER_REF_SELECT },
} satisfies Prisma.IncidentInclude;

export type IncidentListRow = Prisma.IncidentGetPayload<{ include: typeof INCIDENT_LIST_INCLUDE }>;

export const INCIDENT_DETAIL_INCLUDE = {
  reporter: { select: USER_REF_SELECT },
  assignee: { select: USER_REF_SELECT },
  acknowledger: { select: USER_REF_SELECT },
} satisfies Prisma.IncidentInclude;

export type IncidentDetailRow = Prisma.IncidentGetPayload<{ include: typeof INCIDENT_DETAIL_INCLUDE }>;

export interface OrderBy {
  field: 'createdAt' | 'severity' | 'updatedAt';
  direction: 'asc' | 'desc';
}

/** `$transaction([count, findMany])` so the total and the page are always consistent. */
export async function countAndFindPage(
  actor: Actor,
  filters: IncidentListFilters,
  page: number,
  pageSize: number,
  orderBy: OrderBy,
): Promise<{ items: IncidentListRow[]; totalItems: number }> {
  const where = buildWhere(actor, filters);
  const [totalItems, items] = await prisma.$transaction([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      include: INCIDENT_LIST_INCLUDE,
      orderBy: { [orderBy.field]: orderBy.direction },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { items, totalItems };
}

/**
 * The two-query form of §2.3. Query 1 makes the ENTIRE authorization decision — a
 * spread here (not an AND-array) is safe because there is no caller-supplied severity
 * filter to collide with, only visibilityScope's own `severity` key. Query 2 selects
 * only `id`, purely to choose 403 vs 404; it can never grant access.
 */
export function findByIdScoped(id: string, actor: Actor): Promise<IncidentDetailRow | null> {
  return prisma.incident.findFirst({
    where: { id, ...visibilityScope(actor) },
    include: INCIDENT_DETAIL_INCLUDE,
  });
}

export function existsById(id: string): Promise<{ id: string } | null> {
  return prisma.incident.findUnique({ where: { id }, select: { id: true } });
}

export async function findMinePage(
  actor: Actor,
  page: number,
  pageSize: number,
): Promise<{ items: IncidentListRow[]; totalItems: number }> {
  const where: Prisma.IncidentWhereInput = { AND: [visibilityScope(actor), { reporterId: actor.id }] };
  const [totalItems, items] = await prisma.$transaction([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      include: INCIDENT_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { items, totalItems };
}

/** One `groupBy` — never a client-side tally. */
export async function countByStage(actor: Actor): Promise<{ stage: Stage; count: number }[]> {
  const rows = await prisma.incident.groupBy({
    by: ['stage'],
    where: visibilityScope(actor),
    _count: { _all: true },
  });
  return rows.map((r) => ({ stage: r.stage, count: r._count._all }));
}
