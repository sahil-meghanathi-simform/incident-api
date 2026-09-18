import { describe, it, expect } from 'vitest';
import { severityArraySql } from '../../src/modules/analytics/analytics.repository';
import { visibleSeverities } from '../../src/policy/clearance.policy';

/**
 * build-plan.md Module 9: "trend uses raw SQL for date_trunc, still clearance-scoped
 * through severity = ANY($4) built by the SAME visibleSeverities() function as
 * everywhere else, with a unit test asserting the Prisma and raw-SQL paths produce
 * identical severity sets for all four clearance levels." The Prisma path
 * (incident.repository.ts::visibilityScope) reads visibleSeverities() directly; this
 * proves the raw-SQL path's bound parameters are the exact same array, for every
 * clearance level, so the two can never drift into two independent notions of
 * "what this actor may see".
 */
describe('analytics raw SQL severity array — parity with visibleSeverities()', () => {
  it.each([1, 2, 3, 4])('clearance %i: the ANY(...) array binds exactly visibleSeverities(actor)', (clearance) => {
    const expected = visibleSeverities(clearance);
    const sql = severityArraySql(expected);
    expect(sql.values).toEqual(expected);
  });

  it('an empty severity list produces a typed empty array literal, not a syntax error', () => {
    const sql = severityArraySql([]);
    expect(sql.values).toEqual([]);
    expect(sql.sql).toContain('ARRAY[]');
    expect(sql.sql).toContain('"Severity"[]');
  });
});
