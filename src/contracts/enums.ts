import { z } from 'zod';

// This file has no imports outside zod — it is exported verbatim to incident-web via
// `npm run contracts:export` (see scripts/contracts-export.ts and §2.6 of build-plan.md).

export const RoleValues = ['REPORTER', 'TRIAGE_MANAGER', 'INVESTIGATOR', 'ADMIN'] as const;
export const RoleSchema = z.enum(RoleValues);
export type Role = z.infer<typeof RoleSchema>;

// Declaration order is load-bearing: it is rank order, and the backend enum
// (prisma/schema.prisma) intentionally mirrors it. Do not reorder either without
// updating the other and src/config/constants.ts::SEVERITY_RANK together.
export const SeverityValues = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const SeveritySchema = z.enum(SeverityValues);
export type Severity = z.infer<typeof SeveritySchema>;

export const StageValues = ['REPORTED', 'TRIAGE', 'INVESTIGATION', 'PENDING_CLOSURE', 'CLOSED'] as const;
export const StageSchema = z.enum(StageValues);
export type Stage = z.infer<typeof StageSchema>;

export const IncidentTypeValues = [
  'SAFETY',
  'SECURITY',
  'ENVIRONMENTAL',
  'OPERATIONAL',
  'DATA_PRIVACY',
  'EQUIPMENT',
  'OTHER',
] as const;
export const IncidentTypeSchema = z.enum(IncidentTypeValues);
export type IncidentType = z.infer<typeof IncidentTypeSchema>;

export const AuditEventTypeValues = [
  'INCIDENT_CREATED',
  'STAGE_CHANGED',
  'SEVERITY_CHANGED',
  'INVESTIGATOR_ASSIGNED',
  'INVESTIGATOR_UNASSIGNED',
  'INCIDENT_ACKNOWLEDGED',
  'NOTE_ADDED',
  'CLOSURE_PROPOSED',
  'CLOSURE_APPROVED',
  'CLOSURE_REJECTED',
  'INCIDENT_ESCALATED',
  'ACCESS_DENIED',
  'USER_CLEARANCE_CHANGED',
  'USER_ROLE_CHANGED',
] as const;
export const AuditEventTypeSchema = z.enum(AuditEventTypeValues);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;
