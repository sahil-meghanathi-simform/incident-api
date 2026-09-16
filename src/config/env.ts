import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),

  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  ESCALATION_TICK_MS: z.coerce.number().int().positive().default(60_000),
  ESCALATION_LEASE_MS: z.coerce.number().int().positive().default(300_000),
  ESCALATION_BATCH_SIZE: z.coerce.number().int().positive().default(500),

  ESCALATION_HIGH_L1_MINUTES: z.coerce.number().int().positive().default(30),
  ESCALATION_HIGH_L2_MINUTES: z.coerce.number().int().positive().default(90),
  ESCALATION_HIGH_L3_MINUTES: z.coerce.number().int().positive().default(240),
  ESCALATION_CRITICAL_L1_MINUTES: z.coerce.number().int().positive().default(15),
  ESCALATION_CRITICAL_L2_MINUTES: z.coerce.number().int().positive().default(60),
  ESCALATION_CRITICAL_L3_MINUTES: z.coerce.number().int().positive().default(240),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SEED_INCIDENT_COUNT: z.coerce.number().int().nonnegative().default(5000),
  SEED_RANDOM_SEED: z.string().default('incident-poc-2026'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast, before the HTTP listener ever opens (§4.1 requirement).
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
