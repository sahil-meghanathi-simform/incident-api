import type { PrismaClient } from '@prisma/client';

/** Per-test isolation. Leaves the JobLease seed row in place, just clears its claim. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
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
