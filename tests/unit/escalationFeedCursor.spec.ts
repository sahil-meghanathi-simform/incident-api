import { describe, it, expect } from 'vitest';
import {
  decodeEscalationFeedCursor,
  encodeEscalationFeedCursor,
  escalationFeedCursorWhere,
  decodeCreatedAtIdCursor,
} from '../../src/core/pagination';
import { CursorSortMismatchError } from '../../src/core/errors/domain-errors';

describe('escalation feed cursor (S4 — sort-key-tagged, never silently mis-paginates)', () => {
  it('round-trips level/highSeveritySince/id', () => {
    const since = new Date('2026-03-01T12:00:00.000Z');
    const encoded = encodeEscalationFeedCursor(2, since, 'inc123');
    const decoded = decodeEscalationFeedCursor(encoded);
    expect(decoded).toEqual({ level: 2, since, id: 'inc123' });
  });

  it('rejects a cursor minted for a different sort key', () => {
    const foreign = Buffer.from(JSON.stringify({ k: 'createdAt.id', v: [new Date().toISOString(), 'x'] })).toString(
      'base64url',
    );
    expect(() => decodeEscalationFeedCursor(foreign)).toThrow(CursorSortMismatchError);
    // and the inverse: decodeCreatedAtIdCursor equally rejects an escalation-feed cursor
    const escalationCursor = encodeEscalationFeedCursor(1, new Date(), 'x');
    expect(() => decodeCreatedAtIdCursor(escalationCursor)).toThrow(CursorSortMismatchError);
  });

  it('the keyset predicate admits only rows strictly after the cursor in level DESC, highSeveritySince ASC, id ASC order', () => {
    const where = escalationFeedCursorWhere(2, new Date('2026-03-01T00:00:00.000Z'), 'inc-b');
    expect(where.OR).toEqual([
      { currentEscalationLevel: { lt: 2 } },
      { currentEscalationLevel: 2, highSeveritySince: { gt: new Date('2026-03-01T00:00:00.000Z') } },
      { currentEscalationLevel: 2, highSeveritySince: new Date('2026-03-01T00:00:00.000Z'), id: { gt: 'inc-b' } },
    ]);
  });
});
