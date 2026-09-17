import { describe, it, expect } from 'vitest';
import { applySeverityChange } from '../../src/modules/triage/triage.service';
import { SeverityValues, type Severity } from '../../src/contracts/enums';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const CLOCK_STARTED = new Date('2026-05-30T00:00:00.000Z');

function stateAt(overrides: Partial<Parameters<typeof applySeverityChange>[3]> = {}) {
  return {
    highSeveritySince: null,
    escalationCycle: 0,
    currentEscalationLevel: 0,
    acknowledgedAt: null,
    acknowledgedById: null,
    ...overrides,
  };
}

describe('applySeverityChange — build-plan.md finding S1: a TOTAL function over band membership', () => {
  it('entering the band (MEDIUM -> HIGH) starts the clock and a fresh cycle', () => {
    const result = applySeverityChange('MEDIUM', 'HIGH', NOW, stateAt({ escalationCycle: 0 }));
    expect(result).toEqual({
      highSeveritySince: NOW,
      escalationCycle: 1,
      currentEscalationLevel: 0,
      acknowledgedAt: null,
      acknowledgedById: null,
    });
  });

  it('raising within the band (HIGH -> CRITICAL) resets the clock and bumps the cycle, clearing any acknowledgement', () => {
    const result = applySeverityChange(
      'HIGH',
      'CRITICAL',
      NOW,
      stateAt({
        highSeveritySince: CLOCK_STARTED,
        escalationCycle: 1,
        currentEscalationLevel: 2,
        acknowledgedAt: CLOCK_STARTED,
        acknowledgedById: 'u1',
      }),
    );
    expect(result).toEqual({
      highSeveritySince: NOW,
      escalationCycle: 2,
      currentEscalationLevel: 0,
      acknowledgedAt: null,
      acknowledgedById: null,
    });
  });

  it('S1: lowering WITHIN the band (CRITICAL -> HIGH) — the reference plan\'s missing fourth case — preserves the clock, cycle, level and acknowledgement untouched', () => {
    const preserved = stateAt({
      highSeveritySince: CLOCK_STARTED,
      escalationCycle: 3,
      currentEscalationLevel: 2,
      acknowledgedAt: null,
      acknowledgedById: null,
    });
    const result = applySeverityChange('CRITICAL', 'HIGH', NOW, preserved);
    expect(result).toEqual(preserved);
  });

  it('leaving the band (HIGH -> LOW) nulls the clock and resets the level, but does not touch escalationCycle history', () => {
    const result = applySeverityChange(
      'HIGH',
      'LOW',
      NOW,
      stateAt({ highSeveritySince: CLOCK_STARTED, escalationCycle: 2, currentEscalationLevel: 1 }),
    );
    expect(result).toEqual({
      highSeveritySince: null,
      escalationCycle: 2,
      currentEscalationLevel: 0,
      acknowledgedAt: null,
      acknowledgedById: null,
    });
  });

  it('moving within the low band (LOW -> MEDIUM) never touches the clock, which was already null', () => {
    const result = applySeverityChange('LOW', 'MEDIUM', NOW, stateAt());
    expect(result.highSeveritySince).toBeNull();
    expect(result.currentEscalationLevel).toBe(0);
  });

  it('every ordered pair of distinct severities is covered by exactly one of the three branches and never throws', () => {
    for (const from of SeverityValues) {
      for (const to of SeverityValues) {
        if (from === to) continue;
        expect(() => applySeverityChange(from as Severity, to as Severity, NOW, stateAt())).not.toThrow();
      }
    }
  });
});
