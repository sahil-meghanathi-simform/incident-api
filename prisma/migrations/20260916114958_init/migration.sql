-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REPORTER', 'TRIAGE_MANAGER', 'INVESTIGATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('REPORTED', 'TRIAGE', 'INVESTIGATION', 'PENDING_CLOSURE', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('SAFETY', 'SECURITY', 'ENVIRONMENTAL', 'OPERATIONAL', 'DATA_PRIVACY', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('INCIDENT_CREATED', 'STAGE_CHANGED', 'SEVERITY_CHANGED', 'INVESTIGATOR_ASSIGNED', 'INVESTIGATOR_UNASSIGNED', 'INCIDENT_ACKNOWLEDGED', 'NOTE_ADDED', 'CLOSURE_PROPOSED', 'CLOSURE_APPROVED', 'CLOSURE_REJECTED', 'INCIDENT_ESCALATED', 'ACCESS_DENIED', 'USER_CLEARANCE_CHANGED', 'USER_ROLE_CHANGED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'REPORTER',
    "clearanceLevel" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "stage" "Stage" NOT NULL DEFAULT 'REPORTED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "assignedInvestigatorId" TEXT,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "highSeveritySince" TIMESTAMP(3),
    "escalationCycle" INTEGER NOT NULL DEFAULT 0,
    "currentEscalationLevel" INTEGER NOT NULL DEFAULT 0,
    "lastEscalatedAt" TIMESTAMP(3),
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "closureProposedById" TEXT,
    "closureProposedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationNote" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT,
    "actorId" TEXT,
    "type" "AuditEventType" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationTier" (
    "id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "level" INTEGER NOT NULL,
    "thresholdMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "severityAtEscalation" "Severity" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "escalationEventId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "escalated" INTEGER NOT NULL DEFAULT 0,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLease" (
    "jobName" TEXT NOT NULL,
    "ownerRunId" TEXT,
    "heldUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("jobName")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_clearanceLevel_idx" ON "User"("role", "clearanceLevel");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_reference_key" ON "Incident"("reference");

-- CreateIndex
CREATE INDEX "Incident_severity_stage_createdAt_idx" ON "Incident"("severity", "stage", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Incident_createdAt_id_idx" ON "Incident"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Incident_assignedInvestigatorId_stage_idx" ON "Incident"("assignedInvestigatorId", "stage");

-- CreateIndex
CREATE INDEX "Incident_type_severity_createdAt_idx" ON "Incident"("type", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_reporterId_createdAt_idx" ON "Incident"("reporterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "InvestigationNote_incidentId_createdAt_idx" ON "InvestigationNote"("incidentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_incidentId_occurredAt_id_idx" ON "AuditEvent"("incidentId", "occurredAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_type_occurredAt_idx" ON "AuditEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_occurredAt_idx" ON "AuditEvent"("actorId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationTier_severity_level_key" ON "EscalationTier"("severity", "level");

-- CreateIndex
CREATE INDEX "EscalationEvent_triggeredAt_idx" ON "EscalationEvent"("triggeredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "EscalationEvent_incidentId_cycle_level_key" ON "EscalationEvent"("incidentId", "cycle", "level");

-- CreateIndex
CREATE INDEX "NotificationLog_recipientId_readAt_createdAt_idx" ON "NotificationLog"("recipientId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_escalationEventId_recipientId_key" ON "NotificationLog"("escalationEventId", "recipientId");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assignedInvestigatorId_fkey" FOREIGN KEY ("assignedInvestigatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_closureProposedById_fkey" FOREIGN KEY ("closureProposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationNote" ADD CONSTRAINT "InvestigationNote_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationNote" ADD CONSTRAINT "InvestigationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_escalationEventId_fkey" FOREIGN KEY ("escalationEventId") REFERENCES "EscalationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written additions (prisma migrate dev --create-only, then edited).
-- These four objects are NOT representable in schema.prisma. All subsequent
-- schema changes MUST use `prisma migrate dev --create-only` and be checked by
-- hand, or `migrate dev` will generate a DROP for one of these. A CI step
-- asserts all four still exist in pg_constraint/pg_indexes after every deploy
-- (see scripts/check-db-objects.sql).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Clearance is always in [1,4].
ALTER TABLE "User" ADD CONSTRAINT "clearance_range" CHECK ("clearanceLevel" BETWEEN 1 AND 4);

-- 2. Closure requires a real root cause and corrective action, DB-enforced (§2.4 gate 3).
--    btrim() with one argument strips SPACES ONLY, not tabs/newlines/CR — a plain
--    btrim(x) <> '' check would admit a whitespace-only "close via raw SQL" attempt
--    (build-plan.md finding S6). char_length(btrim(x, ' \t\r\n')) >= 20 closes that
--    hole and matches the 20-character floor the Zod schema and the service re-read
--    both enforce, so all three gates agree on the same requirement.
ALTER TABLE "Incident" ADD CONSTRAINT "closed_requires_rca" CHECK (
  "stage" <> 'CLOSED'
  OR (
    "rootCause" IS NOT NULL AND char_length(btrim("rootCause", E' \t\r\n')) >= 20
    AND "correctiveAction" IS NOT NULL AND char_length(btrim("correctiveAction", E' \t\r\n')) >= 20
  )
);

-- 3. The escalation clock is set exactly when severity is HIGH/CRITICAL — never
--    independently. Every write path that changes severity must set/clear
--    highSeveritySince in the SAME statement (see triage.service.ts::applySeverityChange,
--    the single function that owns this invariant).
ALTER TABLE "Incident" ADD CONSTRAINT "high_severity_clock" CHECK (
  "severity" NOT IN ('HIGH', 'CRITICAL') OR "highSeveritySince" IS NOT NULL
);

-- 4. Escalation candidate index. Ordered (highSeveritySince, id) — NOT just
--    (highSeveritySince) — because the job's keyset scan orders by that exact pair
--    (build-plan.md finding 12): a single-column index cannot serve the tiebreaker
--    and Postgres would fall back to a Sort node on every batch.
CREATE INDEX "incident_escalation_candidates"
  ON "Incident" ("highSeveritySince", "id")
  WHERE "acknowledgedAt" IS NULL
    AND "stage" <> 'CLOSED'
    AND "severity" IN ('HIGH', 'CRITICAL');

-- 5. Reference number sequence. incident.service.ts::create allocates from this
--    inside the creation transaction (build-plan.md finding B5 — without this the
--    reference sequence relation does not exist and every incident creation 500s).
CREATE SEQUENCE IF NOT EXISTS "incident_reference_seq" AS bigint START 1;

-- 6. Seed row for the escalation job's run-level lease (build-plan.md finding B3).
--    The job's claim step does `UPDATE ... WHERE jobName = 'escalation'`, which
--    requires the row to already exist.
INSERT INTO "JobLease" ("jobName", "updatedAt") VALUES ('escalation', now()) ON CONFLICT DO NOTHING;
