import { describe, it, expect } from 'vitest';
import { tiersDueFor, type EscalationCandidate } from '../../src/jobs/escalation.job';
import type { Tier } from '../../src/modules/escalation/tiers.repository';

const TIERS: Tier[] = [
  { severity: 'HIGH', level: 1, thresholdMinutes: 30 },
  { severity: 'HIGH', level: 2, thresholdMinutes: 90 },
  { severity: 'HIGH', level: 3, thresholdMinutes: 240 },
  { severity: 'CRITICAL', level: 1, thresholdMinutes: 15 },
  { severity: 'CRITICAL', level: 2, thresholdMinutes: 60 },
  { severity: 'CRITICAL', level: 3, thresholdMinutes: 240 },
];

function candidate(overrides: Partial<EscalationCandidate>): EscalationCandidate {
  return {
    id: 'i1',
    severity: 'HIGH',
    highSeveritySince: new Date('2026-01-01T00:00:00.000Z'),
    escalationCycle: 1,
    currentEscalationLevel: 0,
    ...overrides,
  };
}

describe('tiersDueFor — pure function, the core of the escalation mechanism', () => {
  it('nothing is due before the first threshold elapses', () => {
    const now = new Date('2026-01-01T00:10:00.000Z'); // 10 min in
    expect(tiersDueFor(candidate({}), TIERS, now)).toEqual([]);
  });

  it('level 1 is due exactly at the threshold', () => {
    const now = new Date('2026-01-01T00:30:00.000Z'); // exactly 30 min
    expect(tiersDueFor(candidate({}), TIERS, now)).toEqual([{ level: 1, thresholdMinutes: 30 }]);
  });

  it('a 3-day gap with no prior runs returns levels 1, 2 and 3 in ascending order, one row each', () => {
    const now = new Date('2026-01-04T00:00:00.000Z'); // +3 days
    const due = tiersDueFor(candidate({}), TIERS, now);
    expect(due.map((d) => d.level)).toEqual([1, 2, 3]);
  });

  it('already-crossed levels are excluded once currentEscalationLevel reflects them', () => {
    const now = new Date('2026-01-04T00:00:00.000Z');
    const due = tiersDueFor(candidate({ currentEscalationLevel: 2 }), TIERS, now);
    expect(due.map((d) => d.level)).toEqual([3]);
  });

  it('a fully-escalated incident (level 3 reached) never re-fires for the same severity/cycle', () => {
    const now = new Date('2026-01-10T00:00:00.000Z'); // 9 days later
    const due = tiersDueFor(candidate({ currentEscalationLevel: 3 }), TIERS, now);
    expect(due).toEqual([]);
  });

  it('CRITICAL uses its own (shorter) thresholds, independent of HIGH', () => {
    const now = new Date('2026-01-01T00:16:00.000Z'); // 16 min
    const due = tiersDueFor(candidate({ severity: 'CRITICAL' }), TIERS, now);
    expect(due.map((d) => d.level)).toEqual([1]);
  });
});
