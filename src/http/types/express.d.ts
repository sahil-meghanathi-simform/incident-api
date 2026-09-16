import type { Actor } from '../../types/actor.type';

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      requestId: string;
      log: import('pino').Logger;
      /**
       * validate.middleware.ts writes parsed body/query/params here. Controllers read
       * from req.validated, never the raw Express request accessors directly — Express 5
       * makes the query accessor getter-only, so assigning back to it throws under
       * strict ESM and silently no-ops under sloppy mode (build-plan.md finding B6).
       * An ESLint/grep rule (scripts/check-layers.sh) bans reading it outside this file.
       */
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
      /** Parsed from If-Match by ifMatch.middleware.ts (§2.8 optimistic locking). */
      ifMatchVersion?: number;
    }
  }
}

export {};
