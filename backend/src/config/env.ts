import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const csv = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v))
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: int(3000, 0, 65535),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool(false),

    DATABASE_URL: z.string().min(1).default('postgresql://ptt:ptt@localhost:5432/ptt'),
    DATABASE_PROVIDER: z.enum(['postgresql', 'sqlite']).default('postgresql'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

    CORS_ORIGINS: csv('*'),
    ALLOW_INSECURE_CORS: bool(false),

    JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me'),
    JWT_REFRESH_SECRET: z.string().min(16).default('dev-only-refresh-secret-change-me'),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: int(30, 1, 365),
    PASSWORD_RESET_TTL_MINUTES: int(30, 5, 1440),
    SESSION_IDLE_TIMEOUT_MINUTES: int(4320, 5, 525600),

    SCRYPT_COST: int(16384, 1024, 1 << 22),

    TOTP_ISSUER: z.string().default('PTT'),

    LIVEKIT_URL: z.string().default('ws://localhost:7880'),
    LIVEKIT_API_KEY: z.string().default('devkey'),
    LIVEKIT_API_SECRET: z.string().default('devsecret'),
    LIVEKIT_ENABLED: bool(true),

    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('ptt-voice'),
    S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
    S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
    S3_FORCE_PATH_STYLE: bool(true),
    SIGNED_URL_TTL_SECONDS: int(900, 30, 86400),

    DEEP_LINK_SCHEME: z.string().default('ptt'),
    UNIVERSAL_LINK_HOST: z.string().default('app.ptt.example.com'),
    WEB_BASE_URL: z.string().default('https://app.ptt.example.com'),
    INVITE_BASE_URL: z.string().default('https://link.ptt.example.com'),

    PUSH_ENABLED: bool(true),
    EXPO_ACCESS_TOKEN: z.string().optional(),
    PUSH_HIGH_PRIORITY_CHANNEL_ID: z.string().default('incoming-audio'),

    RATE_LIMIT_MAX: int(300, 1, 1_000_000),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),
    AUTH_RATE_LIMIT_MAX: int(20, 1, 100_000),

    PTT_FLOOR_TTL_SECONDS: int(60, 10, 600),

    MAX_UPLOAD_BYTES: int(26_214_400, 1024, 524_288_000),
    WS_MAX_PAYLOAD_BYTES: int(65_536, 1024, 4_194_304),

    DEFAULT_RETENTION_DAYS: int(30, 1, 3650),
    ECHO_BOT_USER_ID: z.string().optional(),

    METRICS_ENABLED: bool(true),
    SEED_DEMO_DATA: bool(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_ACCESS_SECRET'], message: 'Must be set in production' });
      }
      if (env.JWT_REFRESH_SECRET.startsWith('dev-only')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'Must be set in production' });
      }
      if (!env.ALLOW_INSECURE_CORS && env.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'Wildcard CORS is not allowed in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

export const env: Env = load();
