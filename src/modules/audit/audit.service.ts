import type { TxClient } from '../../db/transaction';
import { createAuditEvent, type CreateAuditEventInput } from './audit.repository';

/**
 * The only way any code in this system writes an audit row. Requires a `tx` client —
 * deliberately no non-transactional overload — making it structurally impossible to
 * record an event for a state change that then rolls back, or to change state without
 * recording it (build-plan.md, Module 2/8).
 */
export function record(tx: TxClient, input: CreateAuditEventInput) {
  return createAuditEvent(input, tx);
}
