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
