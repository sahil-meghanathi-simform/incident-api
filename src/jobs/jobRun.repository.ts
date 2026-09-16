import type { TxClient } from '../db/transaction';
import { prisma } from '../db/prisma';

export const jobRunRepository = {
  async start(jobName: string) {
    return prisma.jobRun.create({ data: { jobName } });
  },

  /** Idempotent: only transitions a run that is still open, so a duplicate finish is a no-op. */
  async finish(
    id: string,
    outcome: 'COMPLETED' | 'SKIPPED_LOCKED' | 'FAILED',
    counts?: { scanned?: number; escalated?: number; notified?: number; error?: string },
  ) {
    await prisma.jobRun.updateMany({
      where: { id, finishedAt: null },
      data: {
        finishedAt: new Date(),
        outcome,
        scanned: counts?.scanned ?? 0,
        escalated: counts?.escalated ?? 0,
        notified: counts?.notified ?? 0,
        error: counts?.error,
      },
    });
  },

  async recent(jobName: string, limit = 20) {
    return prisma.jobRun.findMany({
      where: { jobName },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  },
};

export type { TxClient };
