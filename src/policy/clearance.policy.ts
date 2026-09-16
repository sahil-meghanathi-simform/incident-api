import type { Prisma } from '@prisma/client';
import { SEVERITY_RANK } from '../config/constants';
import { SeverityValues, type Severity } from '../contracts/enums';
import type { Actor } from '../types/actor.type';

export { SEVERITY_RANK };

/** Every severity at or below the actor's clearance. Pure, no I/O, exhaustively unit-tested. */
export function visibleSeverities(clearance: number): Severity[] {
  return SeverityValues.filter((s) => SEVERITY_RANK[s] <= clearance);
}

export function canViewSeverity(actor: Actor, severity: Severity): boolean {
  return SEVERITY_RANK[severity] <= actor.clearanceLevel;
}

/**
 * The single source of truth for "which incidents may this actor read at all". Every
 * incident read composes this fragment via an explicit `AND: [...]` array — NEVER by
 * object-spreading it alongside another filter on the same `severity` key. A spread
 * silently overwrites the `severity` key (JS object semantics, not a Prisma AND), which
 * is exactly the failure this policy exists to prevent — see docs/authorization.md and
 * build-plan.md finding B1 for the reference-plan bug this replaces.
 */
export function visibilityScope(actor: Actor): Prisma.IncidentWhereInput {
  return { severity: { in: visibleSeverities(actor.clearanceLevel) } };
}

/**
 * Intersects a caller-requested severity filter with what the actor may see, so a
 * requested severity above clearance narrows to nothing rather than ever widening
 * access. Used by incident.repository.ts::buildWhere as an explicit second line of
 * defence alongside visibilityScope — belt and braces on the sharpest test in this POC.
 */
export function effectiveSeverities(actor: Actor, requested?: Severity[]): Severity[] {
  const allowed = visibleSeverities(actor.clearanceLevel);
  if (!requested || requested.length === 0) return allowed;
  return requested.filter((s) => allowed.includes(s));
}

export function assertCanView(actor: Actor, incidentSeverity: Severity): boolean {
  return canViewSeverity(actor, incidentSeverity);
}
