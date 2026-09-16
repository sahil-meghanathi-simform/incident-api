import type { Role } from '../contracts/enums';

/** Loaded fresh from the DB on every authenticated request (Q8b) — see authenticate.middleware.ts. */
export interface Actor {
  id: string;
  role: Role;
  clearanceLevel: number;
  sessionId?: string;
}
