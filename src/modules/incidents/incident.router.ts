import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import {
  CreateIncidentRequestSchema,
  IncidentIdParamsSchema,
  ListIncidentsQuerySchema,
  MineQuerySchema,
} from '../../contracts/incident.contract';
import {
  createHandler,
  getByIdHandler,
  listHandler,
  mineHandler,
  summaryHandler,
  typesHandler,
} from './incident.controller';

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
