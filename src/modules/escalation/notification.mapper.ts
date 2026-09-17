import type { NotificationItem } from '../../contracts/escalation.contract';
import type { NotificationRow } from './notification.repository';

export function toNotificationItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    incidentId: row.escalationEvent.incident.id,
    incidentReference: row.escalationEvent.incident.reference,
    incidentTitle: row.escalationEvent.incident.title,
    severity: row.escalationEvent.incident.severity,
    level: row.escalationEvent.level,
    dueAt: row.escalationEvent.dueAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
