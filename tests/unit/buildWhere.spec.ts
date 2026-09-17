import { describe, it, expect } from 'vitest';
import { buildWhere } from '../../src/modules/incidents/incident.repository';
import { visibilityScope } from '../../src/policy/clearance.policy';
import type { Actor } from '../../src/types/actor.type';

function actor(clearanceLevel: number): Actor {
  return { id: 'a1', role: 'REPORTER', clearanceLevel };
}

/**
 * build-plan.md finding B1: the reference plan's object-spread form silently DELETES
 * the clearance scope the moment a caller-supplied severity filter shares the same
 * key. The fix composes with an explicit AND array — this test is the guarantee that
 * every filter combination still carries visibilityScope as AND[0], untouched, and
 * that no AND entry ever carries a severity outside what the actor's clearance allows.
 */
describe('buildWhere — B1: a caller filter can only narrow, never replace, the clearance scope', () => {
  it('with no filters at all, AND[0] is exactly visibilityScope(actor)', () => {
    const a = actor(2);
    const where = buildWhere(a, {});
    expect(where.AND).toBeDefined();
    const and = where.AND as object[];
    expect(and[0]).toEqual(visibilityScope(a));
  });

  it('a same-key severity filter does NOT overwrite visibilityScope — AND[0] survives untouched', () => {
    const a = actor(1);
    const where = buildWhere(a, { severity: ['CRITICAL'] });
    const and = where.AND as Array<{ severity?: { in: string[] } }>;

    // AND[0] is the untouched scope fragment.
    expect(and[0]).toEqual(visibilityScope(a));
    // AND[1] is the second line of defence: the requested CRITICAL is entirely
    // outside clearance 1's visible severities, so it narrows to nothing — never to
    // every CRITICAL incident in the database (the exact failure B1 describes).
    expect(and[1]?.severity?.in).toEqual([]);
  });

  it('a mixed-severity request narrows to only what the actor may see', () => {
    const a = actor(2);
    const where = buildWhere(a, { severity: ['LOW', 'HIGH', 'CRITICAL'] });
    const and = where.AND as Array<{ severity?: { in: string[] } }>;
    expect(and[1]?.severity?.in).toEqual(['LOW']);
  });

  it('every other filter key composes as its own AND entry, never spread onto visibilityScope', () => {
    const a = actor(3);
    const where = buildWhere(a, {
      stage: ['TRIAGE'],
      type: ['SAFETY'],
      assignedToMe: true,
      reportedByMe: true,
      unacknowledged: true,
      escalatedOnly: true,
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-02-01T00:00:00.000Z'),
      q: 'dock',
    });
    const and = where.AND as Record<string, unknown>[];

    expect(and[0]).toEqual(visibilityScope(a));
    expect(and).toContainEqual({ stage: { in: ['TRIAGE'] } });
    expect(and).toContainEqual({ type: { in: ['SAFETY'] } });
    expect(and).toContainEqual({ assignedInvestigatorId: a.id });
    expect(and).toContainEqual({ reporterId: a.id });
    expect(and).toContainEqual({ acknowledgedAt: null });
    expect(and).toContainEqual({ currentEscalationLevel: { gt: 0 } });
    expect(and).toContainEqual({ createdAt: { gte: new Date('2026-01-01T00:00:00.000Z') } });
    expect(and).toContainEqual({ createdAt: { lt: new Date('2026-02-01T00:00:00.000Z') } });

    // The `q` OR lives inside its own AND entry — it can never collide with a
    // future filter's OR (S4's failure mode, same root cause as B1).
    const qEntry = and.find((entry) => 'OR' in entry) as { OR: unknown[] } | undefined;
    expect(qEntry?.OR).toHaveLength(2);
  });

  it('an empty-array filter (e.g. severity: []) is treated as "no filter", not "match nothing"', () => {
    const a = actor(4);
    const where = buildWhere(a, { stage: [] });
    const and = where.AND as Record<string, unknown>[];
    expect(and.some((entry) => 'stage' in entry)).toBe(false);
  });
});
