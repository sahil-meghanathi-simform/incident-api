import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';
import { signAccessToken } from '../../src/modules/auth/token.service';
import { newId } from '../../src/core/ids';

const prisma = new PrismaClient();
const app = createApp();

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, sid: newId() });
}

describe('GET /api/v1/users/assignable-investigators', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('returns only active investigators at or above minClearance, ordered by clearance desc', async () => {
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 2, email: 'inv2@test.local' });
    const inv3 = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3, email: 'inv3@test.local' });
    const inv4 = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4, email: 'inv4@test.local' });
    await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4, isActive: false, email: 'inactive@test.local' });

    const res = await request(app)
      .get('/api/v1/users/assignable-investigators')
      .query({ minClearance: 3 })
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id)).toEqual([inv4.id, inv3.id]);
  });

  it('403s for a role that is neither TRIAGE_MANAGER nor ADMIN', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER' });

    const res = await request(app)
      .get('/api/v1/users/assignable-investigators')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('rejects an out-of-range minClearance with 422', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const res = await request(app)
      .get('/api/v1/users/assignable-investigators')
      .query({ minClearance: 9 })
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);

    expect(res.status).toBe(422);
  });
});
