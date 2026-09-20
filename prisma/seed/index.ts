import { PrismaClient } from '@prisma/client';
import { seedUsers } from './users.seed';
import { seedEscalationTiers } from './escalationTiers.seed';
import { seedIncidents } from './incidents.seed';
import { env } from '../../src/config/env';

const prisma = new PrismaClient();

/**
 * Idempotent orchestrator — safe to run on every `docker compose up` (build-plan.md
 * finding B4c). Users and tiers use upsert; incidents short-circuit once the target
 * count is already met, so a second run never duplicates rows.
 *
 * Escalation tiers are required app config, not demo data — without them
 * `activeTiers()` returns an empty list and the escalation job can never fire
 * (this was dropped by mistake in c804689 and left the job permanently inert).
 */
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('seeding users...');
  await seedUsers(prisma);

  // eslint-disable-next-line no-console
  console.log('seeding escalation tiers...');
  await seedEscalationTiers(prisma);

  // eslint-disable-next-line no-console
  console.log('seeding demo incidents (target 5)...');
  await seedIncidents(prisma, 5, env.SEED_RANDOM_SEED);

  // eslint-disable-next-line no-console
  console.log('seed complete');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
