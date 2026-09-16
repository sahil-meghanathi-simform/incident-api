import type { User } from '@prisma/client';
import { prisma } from '../../db/prisma';
import type { TxClient } from '../../db/transaction';

export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface CreateRefreshTokenInput {
  id: string;
  userId: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export function findUserByEmail(email: string, client: TxClient | typeof prisma = prisma): Promise<User | null> {
  return client.user.findUnique({ where: { email } });
}

export function findUserById(id: string, client: TxClient | typeof prisma = prisma): Promise<User | null> {
  return client.user.findUnique({ where: { id } });
}

// Register always writes role: REPORTER, clearanceLevel: 1 — the defaults on the
// Prisma model itself — so there is no field here an injected body could influence
// even if the .strict() contract schema were ever bypassed.
export function createUser(input: CreateUserInput, client: TxClient | typeof prisma = prisma): Promise<User> {
  return client.user.create({
    data: {
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
    },
  });
}

export function createRefreshToken(input: CreateRefreshTokenInput, client: TxClient | typeof prisma = prisma) {
  return client.refreshToken.create({
    data: {
      id: input.id,
      userId: input.userId,
      sessionId: input.sessionId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    },
  });
}

export function findRefreshTokenByHash(tokenHash: string, client: TxClient | typeof prisma = prisma) {
  return client.refreshToken.findUnique({ where: { tokenHash } });
}

/**
 * Race-safe rotation: only succeeds if the presented token was still live at the moment
 * of the update. Mirrors the conditional `UPDATE ... WHERE ... RETURNING` idiom used
 * elsewhere in this codebase (see build-plan.md findings B2/S8) rather than a
 * read-then-write pair, which would leave a window for two concurrent refreshes to both
 * believe they won. `count === 0` means the token was already rotated or revoked by
 * someone else — the caller must treat that as reuse, not retry.
 */
export async function markRefreshTokenRotated(
  id: string,
  replacedById: string,
  client: TxClient | typeof prisma = prisma,
): Promise<{ rotated: boolean }> {
  const result = await client.refreshToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), replacedById },
  });
  return { rotated: result.count > 0 };
}

export function revokeRefreshTokenById(id: string, client: TxClient | typeof prisma = prisma) {
  return client.refreshToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every still-live token in a rotation family — the reuse-detection response. */
export function revokeSession(sessionId: string, client: TxClient | typeof prisma = prisma) {
  return client.refreshToken.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
