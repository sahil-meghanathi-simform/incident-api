import { AppError, type ErrorDetail } from './AppError';

export class ValidationFailedError extends AppError {
  constructor(details: ErrorDetail[]) {
    super({
      code: 'VALIDATION_FAILED',
      status: 422,
      message: 'The request payload is invalid.',
      details,
    });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super({ code: 'UNAUTHENTICATED', status: 401, message });
  }
}

export class TokenExpiredError extends AppError {
  constructor(message = 'Access token has expired.') {
    super({ code: 'TOKEN_EXPIRED', status: 401, message });
  }
}

export class InsufficientRoleError extends AppError {
  constructor(requiredRoles: string[]) {
    super({
      code: 'INSUFFICIENT_ROLE',
      status: 403,
      message: 'Your role does not permit this action.',
      meta: { requiredRoles },
    });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super({
      code: 'NOT_FOUND',
      status: 404,
      message: id ? `${resource} '${id}' was not found.` : `${resource} was not found.`,
    });
  }
}

export class ConflictError extends AppError {
  constructor(code: AppError['code'], message: string, meta?: Record<string, unknown>) {
    super({ code, status: 409, message, meta });
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'Too many attempts. Please try again later.',
      meta: { retryAfterSeconds },
    });
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred.') {
    super({ code: 'INTERNAL', status: 500, message });
  }
}
