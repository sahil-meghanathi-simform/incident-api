import { createApp } from './app';
import { env } from './config/env';
import { rootLogger } from './core/logger';
import { prisma, disconnectPrisma } from './db/prisma';
import { startScheduler, stopScheduler, drainScheduler } from './jobs/scheduler';

async function main(): Promise<void> {
  await prisma.$connect();
  rootLogger.info('database connected');

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    rootLogger.info({ port: env.PORT }, 'incident-api listening');
  });

  if (env.NODE_ENV !== 'test') {
    startScheduler();
  }

  async function shutdown(signal: string): Promise<void> {
    rootLogger.info({ signal }, 'shutting down');
    stopScheduler();
    await drainScheduler();
    server.close();
    await disconnectPrisma();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  rootLogger.error({ err }, 'fatal error during boot');
  process.exit(1);
});
