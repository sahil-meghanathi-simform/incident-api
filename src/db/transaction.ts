import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export type TxClient = Prisma.TransactionClient;

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * withTransaction takes an explicit options bag (timeout/maxWait) — the reference
 * plan's signature omitted this, which matters because Prisma's interactive-transaction
 * default timeout (5s) is far too short for the escalation job's batch work (§12.1
 * finding B3). Batches pass a generous timeout; ordinary request-scoped writes use the
 * default.
 */
export function withTransaction<T>(
  fn: (tx: TxClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return (prisma as PrismaClient).$transaction(fn, options);
}
