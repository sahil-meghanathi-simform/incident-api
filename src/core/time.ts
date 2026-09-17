/**
 * Injectable clock. Every service and job reads "now" through this interface — never
 * `new Date()` directly and never a bare `@default(now())` write for a column any test
 * time-travels over. This is what lets the escalation tests freeze and advance time
 * deterministically (see tests/scenarios/escalation-idempotency.spec.ts).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test-only clock: starts at a fixed instant and only moves when told to. */
export class FrozenClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}

/**
 * Half-open `[from, to)` period filtering (build-plan.md finding B1/S4): a plain
 * `lte: to` against a date-only string like `2026-09-16` resolves to that day's
 * midnight and silently drops the whole final day. If the input carries no time
 * component, advance the exclusive bound to the start of the next day so that day's
 * rows are included; a full timestamp is used exactly as given.
 */
export function exclusiveEndOfDay(isoDateOrDateTime: string): Date {
  const date = new Date(isoDateOrDateTime);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDateOrDateTime.trim())) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}
