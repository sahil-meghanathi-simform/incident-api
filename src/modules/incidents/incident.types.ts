import type { IncidentType, Prisma, Severity, Stage } from '@prisma/client';
import type {
  ESCALATION_FEED_INCLUDE,
  INCIDENT_DETAIL_INCLUDE,
  INCIDENT_LIST_INCLUDE,
  TRIAGE_ROW_INCLUDE,
} from './incident.repository';

export interface CreateIncidentInput {
  id: string;
  reference: string;
  type: IncidentType;
  severity: Severity;
  title: string;
  description: string;
  imagePath: string | null;
  noImageReason: string | null;
  reporterId: string;
  highSeveritySince: Date | null;
  escalationCycle: number;
  createdAt: Date;
}

export interface IncidentListFilters {
  severity?: Severity[];
  stage?: Stage[];
  type?: IncidentType[];
  assignedToMe?: boolean;
  reportedByMe?: boolean;
  unacknowledged?: boolean;
  escalatedOnly?: boolean;
  from?: Date;
  to?: Date; // exclusive upper bound — callers pass the already-widened value
  q?: string;
}

export type IncidentListRow = Prisma.IncidentGetPayload<{ include: typeof INCIDENT_LIST_INCLUDE }>;

export type IncidentDetailRow = Prisma.IncidentGetPayload<{ include: typeof INCIDENT_DETAIL_INCLUDE }>;

export interface OrderBy {
  field: 'createdAt' | 'severity' | 'updatedAt';
  direction: 'asc' | 'desc';
}

export interface AnalyticsPeriodFilters {
  from: Date;
  to: Date; // exclusive
  type?: IncidentType[];
  stage?: Stage[];
}

export type TriageIncidentRow = Prisma.IncidentGetPayload<{ include: typeof TRIAGE_ROW_INCLUDE }>;

export interface UpdateIncidentStateInput {
  stage?: Stage;
  severity?: Severity;
  assignedInvestigatorId?: string | null;
  acknowledgedAt?: Date | null;
  acknowledgedById?: string | null;
  highSeveritySince?: Date | null;
  escalationCycle?: number;
  currentEscalationLevel?: number;
  rootCause?: string | null;
  correctiveAction?: string | null;
  closureProposedById?: string | null;
  closureProposedAt?: Date | null;
  closedById?: string | null;
  closedAt?: Date | null;
}

export type EscalationFeedIncidentRow = Prisma.IncidentGetPayload<{ include: typeof ESCALATION_FEED_INCLUDE }> & {
  highSeveritySince: Date; // non-null: activeEscalationWhere's currentEscalationLevel > 0 implies it
};

export interface AssignedIncidentRow {
  id: string;
  reference: string;
  severity: Severity;
  stage: Stage;
  version: number;
}

/** The multer memory-storage shape incident.controller.ts hands off from req.file. */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}
