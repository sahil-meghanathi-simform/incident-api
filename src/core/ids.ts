import { createId, isCuid } from '@paralleldrive/cuid2';

export function newId(): string {
  return createId();
}

export function isValidId(value: string): boolean {
  return isCuid(value);
}

/**
 * Human-readable incident reference: INC-<year>-<6-digit sequence>. The sequence comes
 * from a dedicated Postgres sequence (incident_reference_seq, created by hand-written
 * migration — see prisma/migrations) so it is safe under concurrent inserts. A single
 * global sequence means the counter does not reset at a year boundary; documented in
 * the README rather than left to look like a bug.
 */
export function formatIncidentReference(year: number, sequence: bigint | number): string {
  const seq = String(sequence).padStart(6, '0');
  return `INC-${year}-${seq}`;
}
