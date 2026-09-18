import type { PrismaClient, Severity, Stage, IncidentType } from '@prisma/client';
import { newId } from '../../../src/core/ids';

let counter = 0;

export async function createIncident(
  prisma: PrismaClient,
  reporterId: string,
  overrides: Partial<{
    severity: Severity;
    stage: Stage;
    type: IncidentType;
    assignedInvestigatorId: string | null;
    acknowledgedAt: Date | null;
    acknowledgedById: string | null;
    highSeveritySince: Date | null;
    escalationCycle: number;
    currentEscalationLevel: number;
    rootCause: string | null;
    correctiveAction: string | null;
    createdAt: Date;
  }> = {},
) {
  counter += 1;
  const severity = overrides.severity ?? 'LOW';
  const stage = overrides.stage ?? 'REPORTED';
  const isHighBand = severity === 'HIGH' || severity === 'CRITICAL';
  const isClosed = stage === 'CLOSED';

  // Same discipline as prisma/seed/incidents.seed.ts (build-plan.md finding B4): RCA and
  // the escalation clock are DERIVED from stage/severity, never left independent, or the
  // CHECK constraints correctly reject the row — as they just did here.
  return prisma.incident.create({
    data: {
      id: newId(),
      reference: `INC-TEST-${String(counter).padStart(6, '0')}`,
      type: overrides.type ?? 'SAFETY',
      severity,
      stage,
      title: `Test incident ${counter}`,
      description: 'A description long enough to satisfy validation rules in every test context.',
      reporterId,
      // Module 9's period-boundary tests need incidents pinned to an exact instant
      // (e.g. exactly at a query's exclusive `to`) — createdAt has no @updatedAt-style
      // auto-touch, so setting it explicitly on create is safe and stays put.
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      assignedInvestigatorId: overrides.assignedInvestigatorId ?? null,
      acknowledgedAt: overrides.acknowledgedAt ?? null,
      acknowledgedById: overrides.acknowledgedById ?? null,
      highSeveritySince: overrides.highSeveritySince ?? (isHighBand ? new Date() : null),
      escalationCycle: overrides.escalationCycle ?? (isHighBand ? 1 : 0),
      currentEscalationLevel: overrides.currentEscalationLevel ?? 0,
      rootCause: overrides.rootCause !== undefined ? overrides.rootCause : isClosed
        ? 'A root cause long enough to satisfy the twenty character minimum.'
        : null,
      correctiveAction: overrides.correctiveAction !== undefined ? overrides.correctiveAction : isClosed
        ? 'A corrective action long enough to satisfy the minimum length.'
        : null,
    },
  });
}
