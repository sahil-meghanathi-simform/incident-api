export interface SeverityClockFields {
  highSeveritySince: Date | null;
  escalationCycle: number;
  currentEscalationLevel: number;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
}
