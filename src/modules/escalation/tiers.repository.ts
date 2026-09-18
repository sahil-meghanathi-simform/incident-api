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

/**
 * Module 10's PUT /admin/escalation-tiers: "replace the tier set atomically". No FK
 * anywhere references EscalationTier.id, so delete-then-recreate inside the caller's
 * transaction is safe and simplest — there is no partial-update state to reconcile
 * against. Contiguity/monotonicity were already enforced by TierSetRequestSchema
 * before this ever runs.
 */
export async function replaceTierSet(tiers: Tier[], updatedById: string, tx: TxClient): Promise<void> {
  await tx.escalationTier.deleteMany({});
  await tx.escalationTier.createMany({
    data: tiers.map((t) => ({ severity: t.severity, level: t.level, thresholdMinutes: t.thresholdMinutes, updatedById })),
  });
}
