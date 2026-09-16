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
