import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';

const prisma = new PrismaClient();
const app = createApp();

describe('POST /api/v1/auth/refresh — rotation and reuse detection', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('rotates: the old refresh cookie stops working once a new one has been issued', async () => {
    await createUser(prisma, { email: 'user@test.local' });
    const agent = request.agent(app);

    const login = await agent.post('/api/v1/auth/login').send({ email: 'user@test.local', password: 'Password123!' });
    const oldCookie = login.headers['set-cookie'][0];

    const firstRefresh = await agent.post('/api/v1/auth/refresh');
    expect(firstRefresh.status).toBe(200);
    expect(typeof firstRefresh.body.accessToken).toBe('string');
    expect(await prisma.refreshToken.count()).toBe(2); // original (revoked) + rotated

    // Presenting the now-stale cookie again must fail, not silently succeed.
    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(reuse.status).toBe(401);
  });

  it('reuse of a revoked token revokes the whole session family — a sibling refresh also stops working', async () => {
    await createUser(prisma, { email: 'user@test.local' });
    const agent = request.agent(app);

    const login = await agent.post('/api/v1/auth/login').send({ email: 'user@test.local', password: 'Password123!' });
    const originalCookie = login.headers['set-cookie'][0];

    const rotated = await agent.post('/api/v1/auth/refresh');
    const rotatedCookie = rotated.headers['set-cookie'][0];
    expect(rotatedCookie).toBeTruthy();

    // Present the ORIGINAL (already-rotated-away) cookie — reuse.
    const reuseAttempt = await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie);
    expect(reuseAttempt.status).toBe(401);

    // The rotated (otherwise still-valid) sibling must now also be dead.
    const siblingAttempt = await request(app).post('/api/v1/auth/refresh').set('Cookie', rotatedCookie);
    expect(siblingAttempt.status).toBe(401);

    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('logout revokes the session — refresh no longer works afterwards', async () => {
    await createUser(prisma, { email: 'user@test.local' });
    const agent = request.agent(app);

    const login = await agent.post('/api/v1/auth/login').send({ email: 'user@test.local', password: 'Password123!' });
    const accessToken = login.body.accessToken as string;

    const logoutRes = await agent.post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await agent.post('/api/v1/auth/refresh');
    expect(refreshAfterLogout.status).toBe(401);
  });
});
