import { describe, it, expect } from 'vitest';
import { visibleSeverities, canViewSeverity, effectiveSeverities } from '../../src/policy/clearance.policy';
import type { Actor } from '../../src/types/actor.type';

function actor(clearanceLevel: number): Actor {
  return { id: 'a1', role: 'REPORTER', clearanceLevel };
}

describe('visibleSeverities — truth table for every clearance level (Q8b/Q9 foundation)', () => {
  it.each([
    [1, ['LOW']],
    [2, ['LOW', 'MEDIUM']],
    [3, ['LOW', 'MEDIUM', 'HIGH']],
    [4, ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']],
  ] as const)('clearance %i sees exactly %j', (clearance, expected) => {
    expect(visibleSeverities(clearance)).toEqual(expected);
  });
});

describe('canViewSeverity', () => {
  it('a clearance-1 reporter cannot view a HIGH incident', () => {
    expect(canViewSeverity(actor(1), 'HIGH')).toBe(false);
  });
  it('a clearance-3 user can view HIGH but not CRITICAL', () => {
    expect(canViewSeverity(actor(3), 'HIGH')).toBe(true);
    expect(canViewSeverity(actor(3), 'CRITICAL')).toBe(false);
  });
});

describe('effectiveSeverities — build-plan.md finding B1: a requested filter can only NARROW, never widen', () => {
  it('a clearance-1 user requesting CRITICAL gets nothing back, not an error and not CRITICAL data', () => {
    expect(effectiveSeverities(actor(1), ['CRITICAL'])).toEqual([]);
  });
  it('a clearance-4 user requesting CRITICAL gets CRITICAL', () => {
    expect(effectiveSeverities(actor(4), ['CRITICAL'])).toEqual(['CRITICAL']);
  });
  it('no requested filter falls back to everything the actor may see', () => {
    expect(effectiveSeverities(actor(2))).toEqual(['LOW', 'MEDIUM']);
  });
  it('a mixed request is filtered down to only the allowed members, preserving order', () => {
    expect(effectiveSeverities(actor(2), ['LOW', 'HIGH', 'CRITICAL'])).toEqual(['LOW']);
  });
});
