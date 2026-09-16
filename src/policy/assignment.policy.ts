import { SEVERITY_RANK } from '../config/constants';
import type { Severity } from '../contracts/enums';

export function canAssignInvestigator(investigatorClearance: number, incidentSeverity: Severity): boolean {
  return investigatorClearance >= SEVERITY_RANK[incidentSeverity];
}

/** Q17 cascade: does raising severity strand the current assignee below their clearance? */
export function mustUnassignOnRaise(assigneeClearance: number | null | undefined, newSeverity: Severity): boolean {
  if (assigneeClearance == null) return false;
  return assigneeClearance < SEVERITY_RANK[newSeverity];
}
