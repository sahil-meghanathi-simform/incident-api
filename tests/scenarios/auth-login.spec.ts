import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';

const prisma = new PrismaClient();
const app = createApp();

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('correct credentials succeed and set a refresh cookie', async () => {
    await createUser(prisma, { email: 'user@test.local' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user@test.local', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.headers['set-cookie']?.[0]).toMatch(/refreshToken=/);
  });

  it('unknown email and wrong password produce the identical generic 401', async () => {
    await createUser(prisma, { email: 'user@test.local' });

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user@test.local', password: 'nope' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'nope' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('UNAUTHENTICATED');
    expect(unknownEmail.body.error.code).toBe('UNAUTHENTICATED');
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('an inactive user cannot log in even with the correct password', async () => {
    await createUser(prisma, { email: 'inactive@test.local', isActive: false });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'inactive@test.local', password: 'Password123!' });

    expect(res.status).toBe(401);
  });
});
