import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { CreateIncidentRequestSchema } from '../../contracts/incident.contract';
import { createHandler, typesHandler } from './incident.controller';

export const incidentRouter = Router();

// Literal route, registered before any `/:id` route lands in Module 3 — the ordering
// this guards against is build-plan.md finding S7.
incidentRouter.get('/types', authenticate, asyncHandler(typesHandler));

incidentRouter.post('/', authenticate, validate({ body: CreateIncidentRequestSchema }), asyncHandler(createHandler));
