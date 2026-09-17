import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { ifMatch } from '../../http/middleware/ifMatch.middleware';
import {
  CreateIncidentRequestSchema,
  IncidentIdParamsSchema,
  ListIncidentsQuerySchema,
  MineQuerySchema,
} from '../../contracts/incident.contract';
import { AssignInvestigatorRequestSchema, ChangeSeverityRequestSchema } from '../../contracts/triage.contract';
import { AddNoteRequestSchema, NotesCursorQuerySchema } from '../../contracts/investigation.contract';
import {
  ApproveClosureRequestSchema,
  ProposeClosureRequestSchema,
  RejectClosureRequestSchema,
} from '../../contracts/closure.contract';
import {
  createHandler,
  getByIdHandler,
  listHandler,
  mineHandler,
  summaryHandler,
  typesHandler,
} from './incident.controller';
import {
  acknowledgeHandler,
  assignInvestigatorHandler,
  changeSeverityHandler,
  triageHandler,
  unassignInvestigatorHandler,
} from '../triage/triage.controller';
import { addNoteHandler, listNotesHandler } from '../investigation/investigation.controller';
import { approveClosureHandler, proposeClosureHandler, rejectClosureHandler } from '../closure/closure.controller';

export const incidentRouter = Router();

// Literal segments MUST be registered before `/:id` — Express matches in registration
// order, and `:id` would otherwise shadow `/mine`, `/types` and `/summary` entirely
// (build-plan.md finding S7: `GET /incidents/mine` would look up an incident literally
// named "mine" and 404). `validate({ params })` on `:id` turns any future collision
// into a 422 at the validation layer instead of a silent 404.
incidentRouter.get('/types', authenticate, asyncHandler(typesHandler));
incidentRouter.get('/mine', authenticate, validate({ query: MineQuerySchema }), asyncHandler(mineHandler));
incidentRouter.get('/summary', authenticate, asyncHandler(summaryHandler));

incidentRouter.post('/', authenticate, validate({ body: CreateIncidentRequestSchema }), asyncHandler(createHandler));
incidentRouter.get('/', authenticate, validate({ query: ListIncidentsQuerySchema }), asyncHandler(listHandler));

incidentRouter.get(
  '/:id',
  authenticate,
  validate({ params: IncidentIdParamsSchema }),
  asyncHandler(getByIdHandler),
);

// ---------------------------------------------------------------------------
// Module 4 — Triage, Severity & Assignment. All mutations require If-Match (§2.8);
// ifMatch runs after validate() per app.ts's documented middleware order.
// ---------------------------------------------------------------------------

const TRIAGE_ROLES = ['TRIAGE_MANAGER', 'ADMIN'] as const;

incidentRouter.post(
  '/:id/triage',
  authenticate,
  authorizeRole(...TRIAGE_ROLES),
  validate({ params: IncidentIdParamsSchema }),
  ifMatch,
  asyncHandler(triageHandler),
);

incidentRouter.patch(
  '/:id/severity',
  authenticate,
  authorizeRole(...TRIAGE_ROLES),
  validate({ params: IncidentIdParamsSchema, body: ChangeSeverityRequestSchema }),
  ifMatch,
  asyncHandler(changeSeverityHandler),
);

incidentRouter.post(
  '/:id/assignment',
  authenticate,
  authorizeRole(...TRIAGE_ROLES),
  validate({ params: IncidentIdParamsSchema, body: AssignInvestigatorRequestSchema }),
  ifMatch,
  asyncHandler(assignInvestigatorHandler),
);

incidentRouter.delete(
  '/:id/assignment',
  authenticate,
  authorizeRole(...TRIAGE_ROLES),
  validate({ params: IncidentIdParamsSchema }),
  ifMatch,
  asyncHandler(unassignInvestigatorHandler),
);

incidentRouter.post(
  '/:id/acknowledge',
  authenticate,
  authorizeRole(...TRIAGE_ROLES),
  validate({ params: IncidentIdParamsSchema }),
  ifMatch,
  asyncHandler(acknowledgeHandler),
);

// ---------------------------------------------------------------------------
// Module 5 — Investigation & Notes. No authorizeRole gate here: the two-gate rule
// (clearance + assignment-or-Admin) is a per-incident, per-actor decision, not a
// static role list, so it is enforced entirely by investigation.service.ts — a
// REPORTER who CAN see the incident must still get 403 NOT_ASSIGNED_INVESTIGATOR,
// not 403 INSUFFICIENT_ROLE (§10.1 tests). Not If-Match-gated: notes are append-only
// and never touch the incident's own `version`.
// ---------------------------------------------------------------------------

incidentRouter.get(
  '/:id/notes',
  authenticate,
  validate({ params: IncidentIdParamsSchema, query: NotesCursorQuerySchema }),
  asyncHandler(listNotesHandler),
);

incidentRouter.post(
  '/:id/notes',
  authenticate,
  validate({ params: IncidentIdParamsSchema, body: AddNoteRequestSchema }),
  asyncHandler(addNoteHandler),
);

// ---------------------------------------------------------------------------
// Module 6 — Closure. closure-proposal has no static authorizeRole gate — same
// reasoning as notes above: "assignee or Admin" is a per-incident decision the service
// enforces itself (403 NOT_ASSIGNED_INVESTIGATOR), not a static role list. Approval and
// rejection are a coarse TRIAGE_MANAGER/ADMIN gate, same as every Module 4 mutation.
// All three are If-Match-locked like every other incident mutation (§2.8).
// ---------------------------------------------------------------------------

incidentRouter.post(
  '/:id/closure-proposal',
  authenticate,
  validate({ params: IncidentIdParamsSchema, body: ProposeClosureRequestSchema }),
  ifMatch,
  asyncHandler(proposeClosureHandler),
);

incidentRouter.post(
  '/:id/closure-approval',
  authenticate,
  authorizeRole(...TRIAGE_ROLES),
  validate({ params: IncidentIdParamsSchema, body: ApproveClosureRequestSchema }),
  ifMatch,
  asyncHandler(approveClosureHandler),
);

incidentRouter.post(
  '/:id/closure-rejection',
  authenticate,
  authorizeRole(...TRIAGE_ROLES),
  validate({ params: IncidentIdParamsSchema, body: RejectClosureRequestSchema }),
  ifMatch,
  asyncHandler(rejectClosureHandler),
);
