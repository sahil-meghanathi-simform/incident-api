import { z } from 'zod';
import { RoleSchema } from './enums';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

// .strict() is not a style choice: it is the mechanism behind Q7 — role/clearanceLevel
// (or any other field) sent on a register body is rejected with 422 rather than silently
// ignored, so body-injection cannot even reach the service layer.
export const RegisterRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(200),
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1).max(200),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  clearanceLevel: z.number().int().min(1).max(4),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  user: UserSummarySchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const MeResponseSchema = UserSummarySchema;
export type MeResponse = z.infer<typeof MeResponseSchema>;
