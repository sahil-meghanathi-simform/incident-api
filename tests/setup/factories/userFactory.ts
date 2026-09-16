import type { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { newId } from '../../../src/core/ids';

let counter = 0;

export async function createUser(
  prisma: PrismaClient,
  overrides: Partial<{ role: Role; clearanceLevel: number; email: string; isActive: boolean }> = {},
) {
  counter += 1;
  return prisma.user.create({
    data: {
      id: newId(),
      email: overrides.email ?? `user${counter}.${newId()}@test.local`,
      passwordHash: await bcrypt.hash('Password123!', 4), // low cost in tests, speed over realism
      displayName: `Test User ${counter}`,
      role: overrides.role ?? 'REPORTER',
      clearanceLevel: overrides.clearanceLevel ?? 1,
      isActive: overrides.isActive ?? true,
    },
  });
}
