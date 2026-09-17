import { HIGH_BAND_RANK, SEVERITY_RANK } from '../../config/constants';
import { formatIncidentReference, newId } from '../../core/ids';
import { exclusiveEndOfDay } from '../../core/time';
import { withTransaction } from '../../db/transaction';
import { IncidentTypeValues, SeverityValues, StageValues } from '../../contracts/enums';
import type {
  CreateIncidentRequest,
  IncidentDetail,
  IncidentListResponse,
  IncidentReceipt,
  IncidentSummary,
  IncidentTypesResponse,
  ListIncidentsQuery,
} from '../../contracts/incident.contract';
import { buildOffsetPage } from '../../core/pagination';
import { canViewSeverity } from '../../policy/clearance.policy';
import { InsufficientClearanceError } from '../../core/errors/domain-errors';
import { NotFoundError } from '../../core/errors/http-errors';
import type { Actor } from '../../types/actor.type';
import * as auditService from '../audit/audit.service';
import { toIncidentDetail, toIncidentListItem } from './incident.mapper';
import {
  countAndFindPage,
  countByStage,
  createIncident,
  existsById,
  findByIdScoped,
  findMinePage,
  findTriageRowScoped,
  nextReferenceSequence,
  type IncidentListFilters,
  type TriageIncidentRow,
} from './incident.repository';

const TYPE_LABEL: Record<(typeof IncidentTypeValues)[number], string> = {
  SAFETY: 'Safety',
  SECURITY: 'Security',
  ENVIRONMENTAL: 'Environmental',
  OPERATIONAL: 'Operational',
  DATA_PRIVACY: 'Data Privacy',
  EQUIPMENT: 'Equipment',
  OTHER: 'Other',
};

const SEVERITY_LABEL: Record<(typeof SeverityValues)[number], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

/**
 * §7.1: allocates the reference and sets highSeveritySince (Q19) in one transaction,
 * writes the INCIDENT_CREATED audit row in the SAME transaction via auditService.record
 * (whose signature requires a tx client — no incident can exist without it), and
 * returns a receipt DTO, never the incident itself (Q9).
 */
export async function create(actor: Actor, input: CreateIncidentRequest): Promise<IncidentReceipt> {
  const now = new Date();
  const isHighBand = SEVERITY_RANK[input.severity] >= HIGH_BAND_RANK;

  const incident = await withTransaction(async (tx) => {
    const sequence = await nextReferenceSequence(tx);
    const reference = formatIncidentReference(now.getUTCFullYear(), sequence);

    const created = await createIncident(
      {
        id: newId(),
        reference,
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description,
        reporterId: actor.id,
        highSeveritySince: isHighBand ? now : null,
        escalationCycle: isHighBand ? 1 : 0,
        createdAt: now,
      },
      tx,
    );

    await auditService.record(tx, {
      incidentId: created.id,
      actorId: actor.id,
      type: 'INCIDENT_CREATED',
      toValue: created.severity,
      payload: { type: created.type, stage: created.stage },
      occurredAt: now,
    });

    return created;
  });

  return {
    id: incident.id,
    reference: incident.reference,
    createdAt: incident.createdAt.toISOString(),
    severity: incident.severity,
    visibleToYou: canViewSeverity(actor, incident.severity),
  };
}

/** Pure enum metadata for the report form — no I/O, so no repository round trip. */
export function typesForForm(): IncidentTypesResponse {
  return {
    types: IncidentTypeValues.map((value) => ({ value, label: TYPE_LABEL[value] })),
    severities: SeverityValues.map((value) => ({ value, label: SEVERITY_LABEL[value] })),
  };
}

// ---------------------------------------------------------------------------
// Module 3 — Read & Visibility
// ---------------------------------------------------------------------------

function toRepositoryFilters(query: ListIncidentsQuery): IncidentListFilters {
  return {
    severity: query.severity,
    stage: query.stage,
    type: query.type,
    assignedToMe: query.assignedToMe,
    reportedByMe: query.reportedByMe,
    unacknowledged: query.unacknowledged,
    escalatedOnly: query.escalatedOnly,
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? exclusiveEndOfDay(query.to) : undefined,
  };
}

export async function list(actor: Actor, query: ListIncidentsQuery): Promise<IncidentListResponse> {
  const { items, totalItems } = await countAndFindPage(actor, toRepositoryFilters(query), query.page, query.pageSize, {
    field: query.sort,
    direction: query.order,
  });
  return buildOffsetPage(items.map(toIncidentListItem), totalItems, query.page, query.pageSize);
}

/**
 * §2.3's by-ID form, generalised over which row shape the caller needs. Query 1 (the
 * `finder`) makes the ENTIRE authorization decision; a hit returns the row and nothing
 * else runs. A miss means either the incident doesn't exist or the actor's clearance
 * doesn't cover it — query 2 (existsById, id-only) exists solely to choose which, and
 * cannot itself grant access. Module 4's triage.service.ts reuses this exact function
 * (build-plan.md: "changeSeverity loads through getByIdForActor") so a triager cannot
 * act on an incident they cannot see, without duplicating the denial/404 logic here.
 */
async function loadForActorOrThrow<T>(
  id: string,
  actor: Actor,
  finder: (id: string, actor: Actor) => Promise<T | null>,
): Promise<T> {
  const row = await finder(id, actor);
  if (row) return row;

  const exists = await existsById(id);
  if (exists) {
    auditService.recordDenial({
      incidentId: id,
      actorId: actor.id,
      reason: 'CLEARANCE',
      clearanceLevel: actor.clearanceLevel,
    });
    throw new InsufficientClearanceError(id);
  }
  throw new NotFoundError('Incident', id);
}

export function getById(actor: Actor, id: string): Promise<IncidentDetail> {
  return loadForActorOrThrow(id, actor, findByIdScoped).then((incident) => toIncidentDetail(incident, actor));
}

/** The raw, triage-oriented row (assignee clearance included) behind every Module 4 mutation. */
export function getByIdForActor(actor: Actor, id: string): Promise<TriageIncidentRow> {
  return loadForActorOrThrow(id, actor, findTriageRowScoped);
}

/** Incidents the actor reported that they may STILL see (Q9) — not every report they filed. */
export async function mine(actor: Actor, page: number, pageSize: number): Promise<IncidentListResponse> {
  const { items, totalItems } = await findMinePage(actor, page, pageSize);
  return buildOffsetPage(items.map(toIncidentListItem), totalItems, page, pageSize);
}

export async function summary(actor: Actor): Promise<IncidentSummary> {
  const rows = await countByStage(actor);
  const counts = Object.fromEntries(StageValues.map((stage) => [stage, 0])) as Record<
    (typeof StageValues)[number],
    number
  >;
  for (const row of rows) counts[row.stage] = row.count;
  return { counts };
}
