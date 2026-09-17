import type { Incident, IncidentType, Severity } from '@prisma/client';
import type { TxClient } from '../../db/transaction';

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
