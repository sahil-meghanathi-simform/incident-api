import { prisma } from '../../db/prisma';
import type { TxClient } from '../../db/transaction';
import type { AssignableInvestigator } from '../../contracts/user.contract';

export async function findAssignableInvestigators(
  minClearance: number,
  client: TxClient | typeof prisma = prisma,
): Promise<AssignableInvestigator[]> {
  return client.user.findMany({
    where: { role: 'INVESTIGATOR', isActive: true, clearanceLevel: { gte: minClearance } },
    orderBy: [{ clearanceLevel: 'desc' }, { displayName: 'asc' }],
    select: { id: true, displayName: true, clearanceLevel: true },
  });
}

export interface InvestigatorRow {
  id: string;
  displayName: string;
  role: 'REPORTER' | 'TRIAGE_MANAGER' | 'INVESTIGATOR' | 'ADMIN';
  clearanceLevel: number;
  isActive: boolean;
}

/** Used by triage.service.ts::assignInvestigator to validate an assignment target. */
export function findInvestigatorById(id: string): Promise<InvestigatorRow | null> {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, displayName: true, role: true, clearanceLevel: true, isActive: true },
  });
}
