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
