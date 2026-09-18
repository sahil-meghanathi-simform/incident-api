import { z } from 'zod';

// Every value here must match a real `code` thrown somewhere in
// src/core/errors/{http-errors,domain-errors}.ts — kept in sync by hand since this
// schema has no reverse check of its own (Module 11 hardening found this enum
// missing five codes that were already live: SEVERITY_UNCHANGED,
// INVALID_ASSIGNMENT_TARGET, NO_INVESTIGATOR_ASSIGNED, INCIDENT_CLOSED,
// EMAIL_ALREADY_EXISTS. Harmless at runtime — error.middleware.ts serializes
// `err.code` directly and neither backend nor frontend ever calls
// `ErrorCodeSchema`/`ErrorEnvelopeSchema.parse()` on a real response, so nothing was
// silently rejecting these — but it made this schema, and docs/api.md's per-endpoint
// error-code lists generated from it, actively wrong).
export const ErrorCodeValues = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'INSUFFICIENT_ROLE',
  'INSUFFICIENT_CLEARANCE',
  'NOT_ASSIGNED_INVESTIGATOR',
  'NOT_FOUND',
  'INVALID_STAGE_TRANSITION',
  'CLOSURE_REQUIREMENTS_MISSING',
  'INVESTIGATOR_CLEARANCE_TOO_LOW',
  'STALE_VERSION',
  'ALREADY_ACKNOWLEDGED',
  'CURSOR_SORT_MISMATCH',
  'SELF_MODIFICATION_FORBIDDEN',
  'LAST_ADMIN',
  'RATE_LIMITED',
  'SEVERITY_UNCHANGED',
  'INVALID_ASSIGNMENT_TARGET',
  'NO_INVESTIGATOR_ASSIGNED',
  'INCIDENT_CLOSED',
  'EMAIL_ALREADY_EXISTS',
  'INTERNAL',
] as const;
export const ErrorCodeSchema = z.enum(ErrorCodeValues);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
  received: z.unknown().optional(),
});

// The single error envelope shape every non-2xx response uses. `details` is present
// only for 422s. `details[].path` is dot-notation matching the form field name, so
// React Hook Form can call setError(path, ...) with no translation layer.
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.array(ErrorDetailSchema).optional(),
    meta: z.record(z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
