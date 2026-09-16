import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';

const prisma = new PrismaClient();
const app = createApp();

describe('Q8b — role/clearance are re-read from the DB on every request, no re-login needed', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('an admin-granted role change takes effect on the very next request with the SAME access token', async () => {
    const user = await createUser(prisma, { email: 'user@test.local', role: 'REPORTER' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user@test.local', password: 'Password123!' });
    const accessToken = login.body.accessToken as string;

    const before = await request(app)
      .get('/api/v1/users/assignable-investigators')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(before.status).toBe(403); // REPORTER is not TRIAGE_MANAGER/ADMIN

    // Simulate an admin action directly against the DB — no token is reissued.
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });

    const after = await request(app)
      .get('/api/v1/users/assignable-investigators')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(after.status).toBe(200);
  });

  it('a clearance change is reflected on GET /auth/me on the very next request with the SAME access token', async () => {
    const user = await createUser(prisma, { email: 'user2@test.local', clearanceLevel: 1 });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user2@test.local', password: 'Password123!' });
    const accessToken = login.body.accessToken as string;

    const before = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(before.body.clearanceLevel).toBe(1);

    await prisma.user.update({ where: { id: user.id }, data: { clearanceLevel: 4 } });

    const after = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(after.body.clearanceLevel).toBe(4);
  });

  it('deactivating a user blocks the very next request with the SAME access token', async () => {
    const user = await createUser(prisma, { email: 'user3@test.local' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user3@test.local', password: 'Password123!' });
    const accessToken = login.body.accessToken as string;

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const after = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(after.status).toBe(401);
  });
});
