import { pino, type Logger, type LoggerOptions } from 'pino';
import { env } from './env.js';

const base: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'ptt-backend', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'newPassword',
      'currentPassword',
      '*.password',
      '*.token',
      'refreshToken',
      'accessToken',
      'totpCode',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    req(req: { method: string; url: string; id?: string; ip?: string }) {
      return { method: req.method, url: req.url, id: req.id, ip: req.ip };
    },
    res(res: { statusCode: number }) {
      return { statusCode: res.statusCode };
    },
  },
};

const prettyEnabled =
  env.NODE_ENV === 'development' && !process.env.VITEST && Boolean(process.stdout.isTTY);

export const logger: Logger = prettyEnabled
  ? pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
      },
    })
    : pino(base);

export type { Logger };
