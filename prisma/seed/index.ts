import { PrismaClient } from '@prisma/client';
import { seedUsers } from './users.seed';

const prisma = new PrismaClient();

/**
 * Idempotent orchestrator — safe to run on every `docker compose up` (build-plan.md
 * finding B4c). Users use upsert, so a second run never duplicates rows.
 */
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('seeding users...');
  await seedUsers(prisma);

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
