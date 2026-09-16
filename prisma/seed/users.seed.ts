import bcrypt from 'bcrypt';
import { PrismaClient, type Role } from '@prisma/client';

const DEMO_PASSWORD = 'Password123!'; // documented in README — every seeded user shares this

interface SeedUser {
  email: string;
  displayName: string;
  role: Role;
  clearanceLevel: number;
}

// Every role × clearance combination, plus a second admin so the "last admin cannot be
// demoted" rule (Module 10) is actually demonstrable without locking yourself out.
export const SEED_USERS: SeedUser[] = [
  { email: 'reporter1@incident.local', displayName: 'Rae Reporter', role: 'REPORTER', clearanceLevel: 1 },
  { email: 'reporter2@incident.local', displayName: 'Remy Reports', role: 'REPORTER', clearanceLevel: 2 },
  { email: 'triage1@incident.local', displayName: 'Tia Triage (C1)', role: 'TRIAGE_MANAGER', clearanceLevel: 1 },
  { email: 'triage2@incident.local', displayName: 'Tomas Triage (C2)', role: 'TRIAGE_MANAGER', clearanceLevel: 2 },
  { email: 'triage3@incident.local', displayName: 'Tara Triage (C3)', role: 'TRIAGE_MANAGER', clearanceLevel: 3 },
  { email: 'triage4@incident.local', displayName: 'Theo Triage (C4)', role: 'TRIAGE_MANAGER', clearanceLevel: 4 },
  { email: 'investigator1@incident.local', displayName: 'Ivy Investigator (C1)', role: 'INVESTIGATOR', clearanceLevel: 1 },
  { email: 'investigator2@incident.local', displayName: 'Ian Investigator (C2)', role: 'INVESTIGATOR', clearanceLevel: 2 },
  { email: 'investigator3@incident.local', displayName: 'Priya Shah', role: 'INVESTIGATOR', clearanceLevel: 3 },
  { email: 'investigator4@incident.local', displayName: 'Isla Investigator (C4)', role: 'INVESTIGATOR', clearanceLevel: 4 },
  { email: 'admin1@incident.local', displayName: 'Ada Admin', role: 'ADMIN', clearanceLevel: 4 },
  { email: 'admin2@incident.local', displayName: 'Adam Admin (backup)', role: 'ADMIN', clearanceLevel: 4 },
];

export async function seedUsers(prisma: PrismaClient): Promise<Map<string, string>> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const idsByEmail = new Map<string, string>();

  for (const u of SEED_USERS) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
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
