import { z } from 'zod';

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
