import type { PrismaClient } from '@prisma/client';
import { flushPendingDenials } from '../../src/modules/audit/audit.service';

/** Per-test isolation. Leaves the JobLease seed row in place, just clears its claim. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  // Drain any still-in-flight recordDenial() writes from the PREVIOUS test before
  // truncating — otherwise a straggling fire-and-forget write can hit a foreign-key
  // violation against a row this truncate just removed (harmless in production, since
  // incidents are never deleted there, but noisy and worth not tripping over in CI).
  await flushPendingDenials();

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "NotificationLog", "EscalationEvent", "AuditEvent", "InvestigationNote",
      "Incident", "RefreshToken", "JobRun", "EscalationTier", "User"
    RESTART IDENTITY CASCADE
  `);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE incident_reference_seq RESTART WITH 1`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "JobLease" ("jobName", "updatedAt") VALUES ('escalation', now())
    ON CONFLICT ("jobName") DO UPDATE SET "ownerRunId" = NULL, "heldUntil" = NULL, "updatedAt" = now()
  `);
}
