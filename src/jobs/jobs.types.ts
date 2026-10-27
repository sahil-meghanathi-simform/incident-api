import type { Clock } from '../core/time';
import type { Logger } from '../core/logger';
import type { Severity } from '../contracts/enums';

export interface EscalationCandidate {
  id: string;
  severity: Severity;
  highSeveritySince: Date;
  escalationCycle: number;
  currentEscalationLevel: number;
}

export interface DueTier {
  level: number;
  thresholdMinutes: number;
}

export interface BatchRow {
  id: string;
  severity: Severity;
  highSeveritySince: Date | null;
  escalationCycle: number;
  currentEscalationLevel: number;
}

export interface EscalationRunResult {
  outcome: 'COMPLETED' | 'SKIPPED_LOCKED' | 'FAILED';
  scanned: number;
  escalated: number;
  notified: number;
}

export interface Deps {
  clock: Clock;
  logger: Logger;
}
