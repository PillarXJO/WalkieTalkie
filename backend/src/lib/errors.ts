import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'rate_limited'
  | 'payload_too_large'
  | 'precondition_failed'
  | 'service_unavailable'
  | 'internal_error';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  rate_limited: 429,
  payload_too_large: 413,
  precondition_failed: 412,
  service_unavailable: 503,
  internal_error: 500,
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.details = details;
    this.expose = this.statusCode < 500;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError('bad_request', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError('unauthorized', message);
  }
  static forbidden(message = 'Insufficient permissions', details?: unknown) {
    return new AppError('forbidden', message, details);
  }
  static notFound(message = 'Resource not found') {
    return new AppError('not_found', message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError('conflict', message, details);
  }
  static gone(message = 'Resource is no longer available') {
    return new AppError('gone', message);
  }
  static preconditionFailed(message: string, details?: unknown) {
    return new AppError('precondition_failed', message, details);
  }
  static unavailable(message: string, details?: unknown) {
    return new AppError('service_unavailable', message, details);
  }
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError('validation_failed', 'Request validation failed', zodDetails(error));
  } else {
    const fastifyError = error as FastifyError;
    const statusCode = fastifyError.statusCode ?? 500;

    if (statusCode === 429) {
      appError = new AppError('rate_limited', 'Too many requests, please slow down');
    } else if (statusCode === 413) {
      appError = new AppError('payload_too_large', 'Request payload too large');
    } else if (statusCode === 400 && fastifyError.validation) {
      appError = new AppError('validation_failed', 'Request validation failed', fastifyError.validation);
    } else if (statusCode >= 400 && statusCode < 500) {
      appError = new AppError('bad_request', fastifyError.message || 'Bad request');
    } else {
      appError = new AppError('internal_error', 'Internal server error');
    }
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'Internal server error',
      requestId: request.id,
      ...(appError.details !== undefined && appError.expose ? { details: appError.details } : {}),
    },
  };

  if (appError.statusCode >= 500) {
    request.log.error({ err: error, url: request.url, method: request.method }, 'request failed');
  } else {
    request.log.debug({ code: appError.code, url: request.url }, 'request rejected');
  }

  void reply.status(appError.statusCode).send(body);
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  const body: ApiErrorBody = {
    error: { code: 'not_found', message: `Route ${request.method} ${request.url} not found`, requestId: request.id },
  };
  void reply.status(404).send(body);
}

export function logUnexpected(error: Error) {
  logger.error({ err: error }, 'unhandled error');
}
