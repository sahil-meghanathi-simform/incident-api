import bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import { newId } from '../../core/ids';
import { withTransaction } from '../../db/transaction';
import { UnauthenticatedError } from '../../core/errors/http-errors';
import { EmailAlreadyExistsError } from '../../core/errors/http-errors';
import type { RegisterRequest, LoginRequest, UserSummary } from '../../contracts/auth.contract';
import {
  createRefreshToken,
  createUser,
  findRefreshTokenByHash,
  findUserByEmail,
  findUserById,
  markRefreshTokenRotated,
  revokeRefreshTokenById,
  revokeSession,
} from './auth.repository';
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiryDate, signAccessToken } from './token.service';

const BCRYPT_COST = 12;

// A stable, precomputed hash with no matching password — bcrypt.compare against it takes
// the same code path (and roughly the same time) as a real user's row, so "email not
// found" and "wrong password" are indistinguishable from response timing, not just message.
const DUMMY_HASH = bcrypt.hashSync('no-such-user-placeholder', BCRYPT_COST);

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    clearanceLevel: user.clearanceLevel,
  };
}

/** Shared by register (auto-login) and login: mints a fresh session + refresh token row. */
async function issueSession(user: User, meta: RequestMeta) {
  const sessionId = newId();
  const accessToken = signAccessToken({ sub: user.id, sid: sessionId });
  const { token: refreshToken, hash } = generateRefreshToken();
  const expiresAt = refreshTokenExpiryDate(new Date());

  await createRefreshToken({
    id: newId(),
    userId: user.id,
    sessionId,
    tokenHash: hash,
    expiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  return { accessToken, refreshToken, user: toUserSummary(user) };
}

export async function register(input: RegisterRequest, meta: RequestMeta) {
  const existing = await findUserByEmail(input.email);
  if (existing) throw new EmailAlreadyExistsError();

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  let user: User;
  try {
    user = await createUser({
      id: newId(),
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    });
  } catch (err) {
    // Unique-constraint race: two concurrent registrations for the same email.
    if (isUniqueEmailViolation(err)) throw new EmailAlreadyExistsError();
    throw err;
  }

  return issueSession(user, meta);
}

export async function login(input: LoginRequest, meta: RequestMeta) {
  const user = await findUserByEmail(input.email);

  const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.isActive || !passwordMatches) {
    throw new UnauthenticatedError('Email or password is incorrect.');
  }

  return issueSession(user, meta);
}

export async function refresh(presentedToken: string, meta: RequestMeta) {
  const hash = hashRefreshToken(presentedToken);
  const row = await findRefreshTokenByHash(hash);

  if (!row) throw new UnauthenticatedError();

  if (row.revokedAt) {
    // Reuse of an already-rotated/rotated-away token: revoke the whole family and force
    // re-login rather than trust anything presenting this token again.
    await revokeSession(row.sessionId);
    throw new UnauthenticatedError('Session has been revoked. Please log in again.');
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    await revokeRefreshTokenById(row.id);
    throw new UnauthenticatedError();
  }

  const newTokenId = newId();
  const { token: newRefreshToken, hash: newHash } = generateRefreshToken();
  const expiresAt = refreshTokenExpiryDate(new Date());

  const accessToken = await withTransaction(async (tx) => {
    const { rotated } = await markRefreshTokenRotated(row.id, newTokenId, tx);
    if (!rotated) {
      // Lost a race to a concurrent refresh using the same token — treat exactly like
      // reuse (do not silently retry or hand out a token anyway).
      await revokeSession(row.sessionId, tx);
      throw new UnauthenticatedError('Session has been revoked. Please log in again.');
    }

    await createRefreshToken(
      {
        id: newTokenId,
        userId: row.userId,
        sessionId: row.sessionId,
        tokenHash: newHash,
        expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
      tx,
    );

    // Same `sid` across the whole rotation family — the access token's session identity
    // never changes just because the refresh token underneath it rotated.
    return signAccessToken({ sub: row.userId, sid: row.sessionId });
  });

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(presentedToken: string | undefined, sessionId: string | undefined): Promise<void> {
  if (presentedToken) {
    const hash = hashRefreshToken(presentedToken);
    const row = await findRefreshTokenByHash(hash);
    if (row) {
      await revokeSession(row.sessionId);
      return;
    }
  }
  if (sessionId) {
    await revokeSession(sessionId);
  }
}

export async function me(userId: string): Promise<UserSummary> {
  const user = await findUserById(userId);
  if (!user) throw new UnauthenticatedError();
  return toUserSummary(user);
}

function isUniqueEmailViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}
