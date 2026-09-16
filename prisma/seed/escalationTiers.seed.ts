import type { PrismaClient } from '@prisma/client';
import { env } from '../../src/config/env';

export async function seedEscalationTiers(prisma: PrismaClient): Promise<void> {
  const tiers = [
    { severity: 'HIGH' as const, level: 1, thresholdMinutes: env.ESCALATION_HIGH_L1_MINUTES },
    { severity: 'HIGH' as const, level: 2, thresholdMinutes: env.ESCALATION_HIGH_L2_MINUTES },
    { severity: 'HIGH' as const, level: 3, thresholdMinutes: env.ESCALATION_HIGH_L3_MINUTES },
    { severity: 'CRITICAL' as const, level: 1, thresholdMinutes: env.ESCALATION_CRITICAL_L1_MINUTES },
    { severity: 'CRITICAL' as const, level: 2, thresholdMinutes: env.ESCALATION_CRITICAL_L2_MINUTES },
    { severity: 'CRITICAL' as const, level: 3, thresholdMinutes: env.ESCALATION_CRITICAL_L3_MINUTES },
  ];

  for (const t of tiers) {
    await prisma.escalationTier.upsert({
      where: { severity_level: { severity: t.severity, level: t.level } },
      update: { thresholdMinutes: t.thresholdMinutes },
      create: t,
    });
  }
}
