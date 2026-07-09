import express, { Request, Response } from 'express';
import request from 'supertest';
import { z } from 'zod';

import { validateBody } from './validateBody';

const simpleSchema = z.object({ name: z.string().min(1) });
const nestedSchema = z.object({ user: z.object({ name: z.string() }) });

function makeApp(schema: z.ZodTypeAny) {
  const app = express();
  app.use(express.json());
  app.post('/test', validateBody(schema), (req: Request, res: Response) => {
    res.json({ ok: true, body: req.body as unknown });
  });
  return app;
}

describe('validateBody middleware', () => {
  it('calls next with the parsed body when input is valid', async () => {
    const res = await request(makeApp(simpleSchema)).post('/test').send({ name: 'Alice' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.body.name).toBe('Alice');
  });

  it('returns 400 VALIDATION_ERROR when a required field is missing', async () => {
    const res = await request(makeApp(simpleSchema)).post('/test').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toContain('name');
  });

  it('returns 400 VALIDATION_ERROR when a string fails min(1)', async () => {
    const res = await request(makeApp(simpleSchema)).post('/test').send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('includes "user.name" in message for a nested path validation error', async () => {
    // Send { user: {} } — user.name is required but absent
    const res = await request(makeApp(nestedSchema)).post('/test').send({ user: {} });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('user.name');
  });

  it('falls back to "body:" prefix when the issue has an empty path', async () => {
    // A refinement on the whole object produces an issue with path []
    const refinedSchema = z.object({ name: z.string() }).refine(() => false, {
      message: 'Top-level refinement failed',
    });
    const res = await request(makeApp(refinedSchema)).post('/test').send({ name: 'valid' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    // Empty path → falls back to "body:" via the `|| 'body'` branch
    expect(res.body.message).toContain('body:');
  });

  it('replaces req.body with the schema-parsed result (strip extra fields)', async () => {
    const strictSchema = z.object({ name: z.string() }).strip();
    const res = await request(makeApp(strictSchema))
      .post('/test')
      .send({ name: 'Bob', extra: 'should be stripped' });

    expect(res.status).toBe(200);
    expect(res.body.body).not.toHaveProperty('extra');
    expect(res.body.body.name).toBe('Bob');
  });
});
