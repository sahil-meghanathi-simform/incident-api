const MIN_RCA_LENGTH = 20;

function meetsMinLength(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.trim().length >= MIN_RCA_LENGTH;
}

/**
 * Gate 2 of the three-layer closure defence (§2.4): re-checked from a DATABASE ROW,
 * never from the request body — the approve endpoint's schema accepts no RCA fields
 * at all, so there is nothing to smuggle in. Gate 3 is the closed_requires_rca CHECK
 * constraint (prisma/migrations), which independently enforces the same 20-char floor
 * after trimming all whitespace (not just spaces — see build-plan.md finding S6).
 */
export function hasClosureRequirements(incident: {
  rootCause: string | null;
  correctiveAction: string | null;
}): boolean {
  return meetsMinLength(incident.rootCause) && meetsMinLength(incident.correctiveAction);
}
