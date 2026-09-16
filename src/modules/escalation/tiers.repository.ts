import type { Severity } from '../../contracts/enums';
import { prisma } from '../../db/prisma';
import type { TxClient } from '../../db/transaction';

export interface Tier {
  severity: Severity;
  level: number;
  thresholdMinutes: number;
}

export async function activeTiers(client: TxClient | typeof prisma = prisma): Promise<Tier[]> {
  const rows = await client.escalationTier.findMany({
    where: { isActive: true },
    orderBy: [{ severity: 'asc' }, { level: 'asc' }],
    select: { severity: true, level: true, thresholdMinutes: true },
  });
  return rows;
}
