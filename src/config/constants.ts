import { env } from './env';

// Re-exported here so modules import constants from one place; kept thin on purpose.
export const ACCESS_TOKEN_TTL_SECONDS = env.ACCESS_TTL_MINUTES * 60;
export const REFRESH_TOKEN_TTL_MS = env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const ESCALATION_BATCH_SIZE = env.ESCALATION_BATCH_SIZE;
export const ESCALATION_LEASE_MS = env.ESCALATION_LEASE_MS;
export const ESCALATION_TICK_MS = env.ESCALATION_TICK_MS;
export const ESCALATION_LOCK_KEY = 8_143_027n;

export const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as const;
export const HIGH_BAND_RANK = SEVERITY_RANK.HIGH; // rank at which the escalation clock starts

export const ANALYTICS_MAX_RANGE_DAYS = 366;
