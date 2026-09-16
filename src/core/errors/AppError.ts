export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'INSUFFICIENT_ROLE'
  | 'INSUFFICIENT_CLEARANCE'
  | 'NOT_ASSIGNED_INVESTIGATOR'
  | 'NOT_FOUND'
  | 'INVALID_STAGE_TRANSITION'
  | 'CLOSURE_REQUIREMENTS_MISSING'
  | 'INVESTIGATOR_CLEARANCE_TOO_LOW'
  | 'STALE_VERSION'
  | 'ALREADY_ACKNOWLEDGED'
  | 'CURSOR_SORT_MISMATCH'
  | 'SELF_MODIFICATION_FORBIDDEN'
  | 'LAST_ADMIN'
  | 'EMAIL_ALREADY_EXISTS'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ErrorDetail {
  path: string;
  code: string;
  message: string;
  received?: unknown;
}

export interface ErrorMeta {
  [key: string]: unknown;
}

/**
 * Base class for every domain/http error in the system. `error.middleware.ts` is the
 * single place that turns an AppError into the §2.7 envelope — nothing else touches
 * res.json for an error path.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];
  readonly meta?: ErrorMeta;

  constructor(params: {
    code: ErrorCode;
    status: number;
    message: string;
    details?: ErrorDetail[];
    meta?: ErrorMeta;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.meta = params.meta;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
