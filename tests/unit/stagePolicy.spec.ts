import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, STAGE_TRANSITIONS } from '../../src/policy/stage.policy';
import { StageValues } from '../../src/contracts/enums';
import { AppError } from '../../src/core/errors/AppError';

const ALL_PAIRS = StageValues.flatMap((from) => StageValues.map((to) => [from, to] as const));

describe('stage.policy — the full transition matrix (§9.1)', () => {
  it.each(ALL_PAIRS)('%s -> %s is legal only if listed in STAGE_TRANSITIONS', (from, to) => {
    expect(canTransition(from, to)).toBe(STAGE_TRANSITIONS[from].includes(to));
  });

  it('REPORTED -> CLOSED is illegal and assertTransition throws 409 INVALID_STAGE_TRANSITION', () => {
    expect(canTransition('REPORTED', 'CLOSED')).toBe(false);
    let caught: unknown;
    try {
      assertTransition('REPORTED', 'CLOSED');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).status).toBe(409);
    expect((caught as AppError).code).toBe('INVALID_STAGE_TRANSITION');
  });

  it('CLOSED is terminal — no outgoing transition is legal', () => {
    for (const to of StageValues) {
      expect(canTransition('CLOSED', to)).toBe(false);
    }
  });

  it('every non-terminal stage has at least one legal transition', () => {
    for (const stage of StageValues) {
      if (stage === 'CLOSED') continue;
      expect(STAGE_TRANSITIONS[stage].length).toBeGreaterThan(0);
    }
  });
});
