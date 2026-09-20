// rules-ok: naming — this file lives in the sibling incident-api repo, which predates
// and does not follow incident-web's architecture.md camelCase-filename convention
// (this PostToolUse hook fires on any src/*.ts path regardless of which repo it's in).
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
  | 'SEVERITY_UNCHANGED'
  | 'INVALID_ASSIGNMENT_TARGET'
  | 'NO_INVESTIGATOR_ASSIGNED'
  | 'INCIDENT_CLOSED'
  | 'IMAGE_OR_REASON_REQUIRED'
  | 'INVALID_IMAGE_FILE'
  | 'IMAGE_UPLOAD_FAILED'
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
    // Deliberately NOT `Object.setPrototypeOf(this, AppError.prototype)` here — with
    // ES2023 as the compile target (tsconfig.json), native class extension of a
    // built-in already wires the prototype chain correctly for every subclass
    // (CursorSortMismatchError, InsufficientClearanceError, ...). Forcing it to
    // AppError.prototype unconditionally, as an older ES5-downlevel shim would need
    // to, instead OVERWRITES a real subclass's chain, so `err instanceof
    // CursorSortMismatchError` would silently read false for an actual
    // CursorSortMismatchError. `err instanceof AppError` still works either way.
    this.name = new.target.name;
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.meta = params.meta;
  }
}
