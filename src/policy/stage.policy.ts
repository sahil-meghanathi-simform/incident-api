import type { Stage } from '../contracts/enums';
import { InvalidStageTransitionError } from '../core/errors/domain-errors';

export const STAGE_TRANSITIONS: Record<Stage, Stage[]> = {
  REPORTED: ['TRIAGE'],
  TRIAGE: ['INVESTIGATION'],
  INVESTIGATION: ['PENDING_CLOSURE', 'TRIAGE'],
  PENDING_CLOSURE: ['CLOSED', 'INVESTIGATION'],
  CLOSED: [],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: Stage, to: Stage, reason?: string): void {
  if (!canTransition(from, to)) {
    throw new InvalidStageTransitionError(from, to, reason);
  }
}
