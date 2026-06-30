import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import config from '../config';
import { query } from '../config/postgres';
import { success } from '../utils/response';
import authenticate from './authenticate';

jest.mock('../config/postgres');
const mockQuery = query as jest.MockedFunction<typeof query>;

const testApp = express();
testApp.use(express.json());
testApp.get('/protected', authenticate, (req, res) => success(res, { userId: req.user?.id }));

const MOCK_USER = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  name: 'Test User',
  email: 'test@example.com',
  role: 'AGENT' as const,
  status: 'ACTIVE' as const,
};

const makeToken = (payload: object, expiresIn: string | number = '1h') =>
  jwt.sign(payload, config.jwt.secret, { expiresIn } as jwt.SignOptions);

describe('authenticate middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(testApp).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Unauthorized');
  });

  it('returns 401 for a malformed / non-JWT token', async () => {
    const res = await request(testApp)
      .get('/protected')
      .set('Authorization', 'Bearer not.a.valid.jwt.token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 for an expired token', async () => {
    const token = makeToken({ sub: MOCK_USER.id, role: MOCK_USER.role }, -1);

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when user is not found in the database', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const token = makeToken({ sub: MOCK_USER.id, role: MOCK_USER.role });

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when the user account is blocked', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MOCK_USER, status: 'BLOCKED' }],
      rowCount: 1,
    } as never);
    const token = makeToken({ sub: MOCK_USER.id, role: MOCK_USER.role });

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('populates req.user and calls next on a valid token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MOCK_USER], rowCount: 1 } as never);
    const token = makeToken({ sub: MOCK_USER.id, role: MOCK_USER.role });

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe(MOCK_USER.id);
  });

  it('returns 401 when token is signed with a wrong secret', async () => {
    const token = jwt.sign({ sub: MOCK_USER.id, role: MOCK_USER.role }, 'wrong-secret', {
      expiresIn: '1h',
    });

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
