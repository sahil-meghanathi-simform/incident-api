import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';

const prisma = new PrismaClient();
const app = createApp();

describe('POST /api/v1/auth/register', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('always creates a REPORTER at clearance 1, ignoring any role/clearance in the body', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'new.reporter@test.local',
      password: 'Password123!',
      displayName: 'New Reporter',
      role: 'ADMIN',
      clearanceLevel: 4,
    });

    // The .strict() contract schema rejects the extra keys outright — this cannot even
    // reach the service layer, let alone create a privileged account.
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');

    expect(await prisma.user.count()).toBe(0);
  });

  it('a well-formed registration succeeds, returns a working access token, and lands at REPORTER/clearance 1', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'reporter@test.local',
      password: 'Password123!',
      displayName: 'A Reporter',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'REPORTER', clearanceLevel: 1, email: 'reporter@test.local' });
    expect(typeof res.body.accessToken).toBe('string');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ role: 'REPORTER', clearanceLevel: 1 });
  });

  it('duplicate email → 409, not a 500', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dup@test.local', password: 'Password123!', displayName: 'First' });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dup@test.local', password: 'Password123!', displayName: 'Second' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(await prisma.user.count()).toBe(1);
  });
});
