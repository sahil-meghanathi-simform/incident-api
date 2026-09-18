import { CursorSortMismatchError } from './errors/domain-errors';

export interface OffsetPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export function buildOffsetPage<T>(
  items: T[],
  totalItems: number,
  page: number,
  pageSize: number,
): OffsetPage<T> {
  return {
    items,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Generic keyset cursor, tagged with the sort key it was produced for (`k`). This is the
 * S4 fix: a plain {createdAt,id} cursor cannot safely paginate a feed sorted by a
 * different key (e.g. the escalation feed's level+dueAt order), and a stale cursor from
 * a different sort must 422 rather than silently mis-paginate.
 */
export interface Cursor<K extends string = string> {
  k: K;
  v: Array<string | number>;
}

export function encodeCursor<K extends string>(cursor: Cursor<K>): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor<K extends string>(raw: string, expectedKey: K): Cursor<K> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new CursorSortMismatchError();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Cursor).k !== expectedKey ||
    !Array.isArray((parsed as Cursor).v)
  ) {
    throw new CursorSortMismatchError();
  }
  return parsed as Cursor<K>;
}

/**
 * The (createdAt, id) cursor used by every "created-at descending" cursor surface
 * (notes, timeline, default escalation ordering). Prisma has no row-value comparison,
 * so the tuple predicate `(createdAt, id) < (cursor.createdAt, cursor.id)` is expressed
 * as the two-branch OR form below — and it MUST be composed inside an AND array by the
 * caller, never spread alongside another filter's OR (see docs/authorization.md).
 */
export const CREATED_AT_ID_KEY = 'createdAt.id' as const;

export function encodeCreatedAtIdCursor(createdAt: Date, id: string): string {
  return encodeCursor({ k: CREATED_AT_ID_KEY, v: [createdAt.toISOString(), id] });
}

export function decodeCreatedAtIdCursor(raw: string): { createdAt: Date; id: string } {
  const c = decodeCursor(raw, CREATED_AT_ID_KEY);
  const [createdAtIso, id] = c.v;
  return { createdAt: new Date(createdAtIso as string), id: id as string };
}

export function createdAtIdCursorWhere(createdAt: Date, id: string) {
  return {
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
  };
}

/**
 * The escalation feed's sort key — `currentEscalationLevel desc, highSeveritySince asc,
 * id asc` ("most severe, then longest-overdue, first"). This ranks by band-entry time
 * rather than a stored `dueAt`, because the feed's rows are INCIDENTS (one per actively
 * escalated, unacknowledged incident — see escalation.repository.ts for why event rows
 * would duplicate an incident once per historical level), and Incident has no `dueAt`
 * column. Within one severity+level pair the tier threshold is fixed, so
 * highSeveritySince asc is exactly dueAt asc; across mixed severities at the same level
 * it is a documented approximation (docs/escalation.md), never a hidden one. A distinct
 * tagged key from CREATED_AT_ID_KEY (S4): a cursor minted for one sort can never
 * silently mis-paginate the other — decodeCursor's `k` check 422s it instead.
 */
export const ESCALATION_FEED_KEY = 'level.highSeveritySince.id' as const;

export function encodeEscalationFeedCursor(level: number, since: Date, id: string): string {
  return encodeCursor({ k: ESCALATION_FEED_KEY, v: [level, since.toISOString(), id] });
}

export function decodeEscalationFeedCursor(raw: string): { level: number; since: Date; id: string } {
  const c = decodeCursor(raw, ESCALATION_FEED_KEY);
  const [level, sinceIso, id] = c.v;
  return { level: level as number, since: new Date(sinceIso as string), id: id as string };
}

/** Keyset predicate for `ORDER BY currentEscalationLevel DESC, highSeveritySince ASC, id ASC`. */
export function escalationFeedCursorWhere(level: number, since: Date, id: string) {
  return {
    OR: [
      { currentEscalationLevel: { lt: level } },
      { currentEscalationLevel: level, highSeveritySince: { gt: since } },
      { currentEscalationLevel: level, highSeveritySince: since, id: { gt: id } },
    ],
  };
}

/**
 * The audit timeline's sort key — `AuditEvent.occurredAt desc, id desc`. Same shape as
 * CREATED_AT_ID_KEY (newest-first, tie-broken by id) but a genuinely distinct field on a
 * different table, so it gets its own tag (S4): a notes cursor and a timeline cursor must
 * never be interchangeable even though both decode to a `{when, id}` pair.
 */
export const OCCURRED_AT_ID_KEY = 'occurredAt.id' as const;

export function encodeOccurredAtIdCursor(occurredAt: Date, id: string): string {
  return encodeCursor({ k: OCCURRED_AT_ID_KEY, v: [occurredAt.toISOString(), id] });
}

export function decodeOccurredAtIdCursor(raw: string): { occurredAt: Date; id: string } {
  const c = decodeCursor(raw, OCCURRED_AT_ID_KEY);
  const [occurredAtIso, id] = c.v;
  return { occurredAt: new Date(occurredAtIso as string), id: id as string };
}

export function occurredAtIdCursorWhere(occurredAt: Date, id: string) {
  return {
    OR: [{ occurredAt: { lt: occurredAt } }, { occurredAt, id: { lt: id } }],
  };
}
