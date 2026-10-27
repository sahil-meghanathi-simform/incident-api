import type { Severity } from '@prisma/client';

export interface OverviewAggregateRow {
  total: number;
  open: number;
  escalated: number;
  medianAckSeconds: number | null;
}

export interface TrendRawRow {
  bucketStart: Date;
  severity: Severity;
  count: number;
}

export interface EscalationPerformanceRawRow {
  severity: Severity;
  escalatedCount: number;
  acknowledgedCount: number;
  medianAckSeconds: number | null;
  p90AckSeconds: number | null;
}
