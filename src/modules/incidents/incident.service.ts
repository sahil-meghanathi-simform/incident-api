import { HIGH_BAND_RANK, SEVERITY_RANK } from '../../config/constants';
import { formatIncidentReference, newId } from '../../core/ids';
import { withTransaction } from '../../db/transaction';
import { IncidentTypeValues, SeverityValues } from '../../contracts/enums';
import type {
  CreateIncidentRequest,
  IncidentReceipt,
  IncidentTypesResponse,
} from '../../contracts/incident.contract';
import { canViewSeverity } from '../../policy/clearance.policy';
import type { Actor } from '../../types/actor.type';
import * as auditService from '../audit/audit.service';
import { createIncident, nextReferenceSequence } from './incident.repository';

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
