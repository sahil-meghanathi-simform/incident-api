import type { EscalationFeedItem, EscalationEventDto, EscalationTierDto } from '../../contracts/escalation.contract';
import type { Tier } from './tiers.repository';
import type { EscalationFeedIncidentRow, CurrentEventRow } from './escalation.repository';

export function toEscalationTierDto(tier: Tier): EscalationTierDto {
  return { severity: tier.severity, level: tier.level, thresholdMinutes: tier.thresholdMinutes };
}

export function toEscalationFeedItem(incident: EscalationFeedIncidentRow, event: CurrentEventRow): EscalationFeedItem {
  return {
    incidentId: incident.id,
    incidentReference: incident.reference,
    incidentTitle: incident.title,
    severity: incident.severity,
    level: event.level,
    cycle: event.cycle,
    dueAt: event.dueAt.toISOString(),
    triggeredAt: event.triggeredAt.toISOString(),
    assignedInvestigator: incident.assignee,
    version: incident.version,
  };
}

export function toEscalationEventDto(event: {
  id: string;
  cycle: number;
  level: number;
  dueAt: Date;
  triggeredAt: Date;
}): EscalationEventDto {
  return {
    id: event.id,
    cycle: event.cycle,
    level: event.level,
    dueAt: event.dueAt.toISOString(),
    triggeredAt: event.triggeredAt.toISOString(),
  };
}
