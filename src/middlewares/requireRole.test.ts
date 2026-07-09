import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { requireRole } from './requireRole';

type UserRole = 'ADMIN' | 'AGENT';

/**
 * Builds a test Express app with a middleware that sets req.user to the given
 * role (or leaves req.user undefined when role is null), followed by requireRole,
 * followed by a simple success handler.
 */
function makeApp(role: UserRole | null, ...roles: UserRole[]) {
  const app = express();

  // Inject a fake req.user — avoids any JWT / DB involvement
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role !== null) {
      req.user = {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        role,
        status: 'ACTIVE',
      };
    }
    next();
  });

  app.get('/test', requireRole(...roles), (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return app;
}

describe('requireRole middleware', () => {
  it('returns 403 when req.user is undefined (unauthenticated)', async () => {
    const res = await request(makeApp(null, 'ADMIN')).get('/test');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Forbidden');
  });

  it('returns 403 when AGENT attempts an ADMIN-only route', async () => {
    const res = await request(makeApp('AGENT', 'ADMIN')).get('/test');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Forbidden');
  });

  it('calls next and returns 200 when ADMIN accesses an ADMIN-only route', async () => {
    const res = await request(makeApp('ADMIN', 'ADMIN')).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('calls next and returns 200 when AGENT accesses an AGENT-only route', async () => {
    const res = await request(makeApp('AGENT', 'AGENT')).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows ADMIN on a route that accepts ADMIN or AGENT (variadic roles)', async () => {
    const res = await request(makeApp('ADMIN', 'ADMIN', 'AGENT')).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows AGENT on a route that accepts ADMIN or AGENT (variadic roles)', async () => {
    const res = await request(makeApp('AGENT', 'ADMIN', 'AGENT')).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
