import { decodeCreatedAtIdCursor, encodeCreatedAtIdCursor, type CursorPage } from '../../core/pagination';
import { NotFoundError } from '../../core/errors/http-errors';
import type { NotificationItem, NotificationsResponse } from '../../contracts/escalation.contract';
import type { Actor } from '../../types/actor.type';
import { countUnread, findNotificationsPage, findOwnNotification, markRead } from './notification.repository';
import { toNotificationItem } from './notification.mapper';

export async function listNotifications(actor: Actor, cursorRaw: string | undefined, pageSize: number): Promise<NotificationsResponse> {
  const cursor = cursorRaw ? decodeCreatedAtIdCursor(cursorRaw) : undefined;
  const [rows, unreadCount] = await Promise.all([findNotificationsPage(actor, cursor, pageSize), countUnread(actor)]);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];
  const result: CursorPage<NotificationItem> = {
    items: page.map(toNotificationItem),
    hasMore,
    nextCursor: hasMore && last ? encodeCreatedAtIdCursor(last.createdAt, last.id) : null,
  };
  return { ...result, unreadCount };
}

/** Ownership-scoped: a notification belonging to someone else 404s, never leaking whose it is. */
export async function markNotificationRead(actor: Actor, id: string): Promise<NotificationItem> {
  const existing = await findOwnNotification(actor, id);
  if (!existing) throw new NotFoundError('Notification', id);

  const now = new Date();
  await markRead(id, now);

  return toNotificationItem({ ...existing, readAt: existing.readAt ?? now });
}
