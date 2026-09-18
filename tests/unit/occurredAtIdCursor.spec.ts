import { describe, it, expect } from 'vitest';
import {
  decodeCreatedAtIdCursor,
  decodeOccurredAtIdCursor,
  encodeOccurredAtIdCursor,
  occurredAtIdCursorWhere,
} from '../../src/core/pagination';
import { CursorSortMismatchError } from '../../src/core/errors/domain-errors';

describe('audit timeline cursor (S4 — sort-key-tagged, never silently mis-paginates)', () => {
  it('round-trips occurredAt/id', () => {
    const occurredAt = new Date('2026-03-01T12:00:00.000Z');
    const encoded = encodeOccurredAtIdCursor(occurredAt, 'evt123');
    const decoded = decodeOccurredAtIdCursor(encoded);
    expect(decoded).toEqual({ occurredAt, id: 'evt123' });
  });

  it('rejects a cursor minted for a different sort key, and the inverse', () => {
    const foreign = Buffer.from(JSON.stringify({ k: 'createdAt.id', v: [new Date().toISOString(), 'x'] })).toString(
      'base64url',
    );
    expect(() => decodeOccurredAtIdCursor(foreign)).toThrow(CursorSortMismatchError);

    const timelineCursor = encodeOccurredAtIdCursor(new Date(), 'x');
    expect(() => decodeCreatedAtIdCursor(timelineCursor)).toThrow(CursorSortMismatchError);
  });

  it('the keyset predicate admits only rows strictly before the cursor in occurredAt DESC, id DESC order', () => {
    const when = new Date('2026-03-01T00:00:00.000Z');
    const where = occurredAtIdCursorWhere(when, 'evt-b');
    expect(where.OR).toEqual([{ occurredAt: { lt: when } }, { occurredAt: when, id: { lt: 'evt-b' } }]);
  });
});
