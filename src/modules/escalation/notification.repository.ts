import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { createdAtIdCursorWhere } from '../../core/pagination';
import { visibilityScope } from '../../policy/clearance.policy';
import type { Actor } from '../../types/actor.type';

/**
 * The S2 fix's second half: a notification is scoped by recipient AND by whether the
 * actor can STILL see the underlying incident today. A notification earned while at
 * clearance 4 must disappear from this list the moment an admin lowers that clearance
 * — otherwise it is a live link into an incident the recipient can no longer open.
 */
function ownNotificationsWhere(actor: Actor): Prisma.NotificationLogWhereInput {
  return {
    AND: [{ recipientId: actor.id }, { escalationEvent: { incident: visibilityScope(actor) } }],
  };
}

export const NOTIFICATION_INCLUDE = {
  escalationEvent: {
    select: {
      level: true,
      dueAt: true,
      incident: { select: { id: true, reference: true, title: true, severity: true } },
    },
  },
} satisfies Prisma.NotificationLogInclude;

export type NotificationRow = Prisma.NotificationLogGetPayload<{ include: typeof NOTIFICATION_INCLUDE }>;

export async function findNotificationsPage(
  actor: Actor,
  cursor: { createdAt: Date; id: string } | undefined,
  pageSize: number,
): Promise<NotificationRow[]> {
  const where: Prisma.NotificationLogWhereInput = {
    AND: [ownNotificationsWhere(actor), ...(cursor ? [createdAtIdCursorWhere(cursor.createdAt, cursor.id)] : [])],
  };
  return prisma.notificationLog.findMany({
    where,
    include: NOTIFICATION_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
  });
}

export function countUnread(actor: Actor): Promise<number> {
  return prisma.notificationLog.count({ where: { AND: [ownNotificationsWhere(actor), { readAt: null }] } });
}

export function findOwnNotification(actor: Actor, id: string): Promise<NotificationRow | null> {
  return prisma.notificationLog.findFirst({ where: { id, recipientId: actor.id }, include: NOTIFICATION_INCLUDE });
}

/** Idempotent: marking an already-read notification read again is a no-op, not an error. */
export async function markRead(id: string, now: Date): Promise<void> {
  await prisma.notificationLog.updateMany({ where: { id, readAt: null }, data: { readAt: now } });
}
