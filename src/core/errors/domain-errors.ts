import { AppError } from './AppError';

/**
 * Thrown by getByIdForActor's authorization decision (§2.3). Carries no incident data —
 * the 403 body is a fixed envelope regardless of what the query almost matched.
 */
export class InsufficientClearanceError extends AppError {
  constructor(incidentId: string) {
    super({
      code: 'INSUFFICIENT_CLEARANCE',
      status: 403,
      message: 'You do not have sufficient clearance to view this incident.',
      meta: { incidentId },
    });
  }
}

export class NotAssignedInvestigatorError extends AppError {
  constructor(incidentId: string) {
    super({
      code: 'NOT_ASSIGNED_INVESTIGATOR',
      status: 403,
      message: 'You are not the assigned investigator for this incident.',
      meta: { incidentId },
    });
  }
}

export class InvalidStageTransitionError extends AppError {
  constructor(from: string, to: string, reason?: string) {
    super({
      code: 'INVALID_STAGE_TRANSITION',
      status: 409,
      message: `Cannot move an incident from ${from} to ${to}.`,
      meta: { from, to, reason },
    });
  }
}

export class ClosureRequirementsMissingError extends AppError {
  constructor() {
    super({
      code: 'CLOSURE_REQUIREMENTS_MISSING',
      status: 409,
      message: 'A root cause and corrective action are required before closure can be approved.',
    });
  }
}

export class InvestigatorClearanceTooLowError extends AppError {
  constructor(required: number, actual: number) {
    super({
      code: 'INVESTIGATOR_CLEARANCE_TOO_LOW',
      status: 409,
      message: 'The selected investigator does not have sufficient clearance for this severity.',
      meta: { required, actual },
    });
  }
}

export class StaleVersionError extends AppError {
  constructor(expected: number) {
    super({
      code: 'STALE_VERSION',
      status: 409,
      message: 'This incident changed while you were editing it. Please refresh and try again.',
      meta: { expected },
    });
  }
}

export class AlreadyAcknowledgedError extends AppError {
  constructor() {
    super({
      code: 'ALREADY_ACKNOWLEDGED',
      status: 409,
      message: 'This incident has already been acknowledged in the current escalation cycle.',
    });
  }
}

export class CursorSortMismatchError extends AppError {
  constructor() {
    super({
      code: 'CURSOR_SORT_MISMATCH',
      status: 422,
      message: 'The pagination cursor does not match the requested sort order.',
    });
  }
}

export class SelfModificationForbiddenError extends AppError {
  constructor() {
    super({
      code: 'SELF_MODIFICATION_FORBIDDEN',
      status: 409,
      message: 'You cannot change your own role or clearance level.',
    });
  }
}

export class LastAdminError extends AppError {
  constructor() {
    super({
      code: 'LAST_ADMIN',
      status: 409,
      message: 'The last active administrator cannot be demoted or deactivated.',
    });
  }
}

export class SeverityUnchangedError extends AppError {
  constructor() {
    super({
      code: 'SEVERITY_UNCHANGED',
      status: 409,
      message: 'The requested severity is the same as the current severity.',
    });
  }
}

export class InvalidAssignmentTargetError extends AppError {
  constructor() {
    super({
      code: 'INVALID_ASSIGNMENT_TARGET',
      status: 409,
      message: 'The selected user is not an active investigator.',
    });
  }
}

export class NoInvestigatorAssignedError extends AppError {
  constructor() {
    super({
      code: 'NO_INVESTIGATOR_ASSIGNED',
      status: 409,
      message: 'This incident has no assigned investigator to remove.',
    });
  }
}

export class IncidentClosedError extends AppError {
  constructor() {
    super({
      code: 'INCIDENT_CLOSED',
      status: 409,
      message: 'This incident is closed and cannot be modified.',
    });
  }
}

/**
 * Module 5 §10.1: notes may only be added while the incident is under active
 * investigation. Reuses the INVALID_STAGE_TRANSITION code (there is no real
 * from/to transition here, just a stage gate) tagged with `meta.reason` so the
 * frontend can distinguish it from an actual stage-map violation.
 */
export class NotesClosedError extends AppError {
  constructor(stage: string) {
    super({
      code: 'INVALID_STAGE_TRANSITION',
      status: 409,
      message: 'Notes can only be added while an incident is under investigation.',
      meta: { stage, reason: 'NOTES_CLOSED' },
    });
  }
}
