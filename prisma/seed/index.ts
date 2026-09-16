import { PrismaClient } from '@prisma/client';
import { seedUsers } from './users.seed';
import { seedEscalationTiers } from './escalationTiers.seed';
import { seedIncidents } from './incidents.seed';
import { env } from '../../src/config/env';

const prisma = new PrismaClient();

/**
 * Idempotent orchestrator — safe to run on every `docker compose up` (build-plan.md
 * finding B4c). Users and tiers use upsert; incidents short-circuit once the target
 * count is already met, so a second run never duplicates the ~5,000-row dataset.
 */
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('seeding users...');
  await seedUsers(prisma);

  // eslint-disable-next-line no-console
  console.log('seeding escalation tiers...');
  await seedEscalationTiers(prisma);

  // eslint-disable-next-line no-console
  console.log(`seeding incidents (target ${env.SEED_INCIDENT_COUNT})...`);
  await seedIncidents(prisma, env.SEED_INCIDENT_COUNT, env.SEED_RANDOM_SEED);

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
