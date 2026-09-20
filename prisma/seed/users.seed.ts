import bcrypt from 'bcrypt';
import { PrismaClient, type Role } from '@prisma/client';

const DEMO_PASSWORD = 'Test@123'; // documented in README — every seeded user shares this

interface SeedUser {
  email: string;
  displayName: string;
  role: Role;
  clearanceLevel: number;
}

// One account per role for demo/QA handoff — email is `<role>@yopmail.com`, same
// password for all. Triage manager and investigator get clearance 4 (not the
// account-creation default of 1): visibilityScope() gates incident visibility by
// clearance (clearance.policy.ts), so a clearance-1 demo account could only ever
// see LOW-severity incidents — unable to triage, investigate, or receive
// escalation notifications for anything HIGH/CRITICAL, which defeats the point
// of a QA handoff account for those roles.
export const SEED_USERS: SeedUser[] = [
  { email: 'reporter@yopmail.com', displayName: 'Reporter', role: 'REPORTER', clearanceLevel: 1 },
  { email: 'triage_manager@yopmail.com', displayName: 'Triage Manager', role: 'TRIAGE_MANAGER', clearanceLevel: 4 },
  { email: 'investigator@yopmail.com', displayName: 'Investigator', role: 'INVESTIGATOR', clearanceLevel: 4 },
  { email: 'admin@yopmail.com', displayName: 'Admin', role: 'ADMIN', clearanceLevel: 4 },
];

export async function seedUsers(prisma: PrismaClient): Promise<Map<string, string>> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const idsByEmail = new Map<string, string>();

  for (const u of SEED_USERS) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { displayName: u.displayName, role: u.role, clearanceLevel: u.clearanceLevel },
      create: {
        email: u.email,
        passwordHash,
        displayName: u.displayName,
        role: u.role,
        clearanceLevel: u.clearanceLevel,
      },
    });
    idsByEmail.set(u.email, row.id);
  }

  return idsByEmail;
}
