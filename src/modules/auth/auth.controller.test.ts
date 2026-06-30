import bcrypt from 'bcrypt';
import request from 'supertest';

import app from '../../app';
import { disconnectPostgres, query } from '../../config/postgres';

const TEST_USER = {
  name: 'Test Agent',
  email: 'agent@test.example.com',
  password: 'TestPass@123',
  role: 'AGENT' as const,
};

async function seedUser(overrides: Partial<typeof TEST_USER & { status: string }> = {}) {
  const u = { ...TEST_USER, ...overrides };
  const hash = await bcrypt.hash(u.password, 12);
  const result = await query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [u.name, u.email, hash, u.role, overrides.status ?? 'ACTIVE'],
  );
  return result.rows[0];
}

async function loginAndGetToken() {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: TEST_USER.email, password: TEST_USER.password });
  return res.body.data?.token as string;
}

describe('Auth Controller (integration)', () => {
  beforeEach(async () => {
    await seedUser();
  });

  afterEach(async () => {
    await query('TRUNCATE attachments, comments, tickets, users RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await disconnectPostgres();
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/login
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/auth/login', () => {
    it('returns 200 with token and user on valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: TEST_USER.email, password: TEST_USER.password });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.user).toMatchObject({
        email: TEST_USER.email,
        role: TEST_USER.role,
      });
      expect(res.body.data.user.password_hash).toBeUndefined();
    });

    it('returns 401 for wrong password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: TEST_USER.email, password: 'WrongPassword!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 for non-existent email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: TEST_USER.password });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 for a blocked account', async () => {
      await query("UPDATE users SET status = 'BLOCKED' WHERE email = $1", [TEST_USER.email]);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: TEST_USER.email, password: TEST_USER.password });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/blocked/i);
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ password: TEST_USER.password });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for an invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: TEST_USER.password });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when password is empty', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: TEST_USER.email, password: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/auth/me
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/auth/me', () => {
    it('returns 401 when no Authorization header is present', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.here');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with the current user profile on a valid token', async () => {
      const token = await loginAndGetToken();

      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        email: TEST_USER.email,
        role: TEST_USER.role,
      });
      expect(res.body.data.password_hash).toBeUndefined();
    });
  });
});
