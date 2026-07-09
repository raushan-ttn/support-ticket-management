import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Express } from 'express';

import config from '../src/config';
import { query } from '../src/config/postgres';

const SALT_ROUNDS = 12;

export interface CreatedUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'AGENT';
}

/**
 * Insert a user directly into the DB and return the user's id, email, and role.
 * Does NOT return a token — use `mintToken` to generate one.
 */
export async function createUserInDb(opts: {
  name?: string;
  email: string;
  role: 'ADMIN' | 'AGENT';
  password?: string;
}): Promise<CreatedUser> {
  const password = opts.password ?? 'Test@1234';
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.name ?? opts.role, opts.email, hash, opts.role],
  );
  return { id: result.rows[0].id, email: opts.email, role: opts.role };
}

/**
 * Sign a short-lived JWT for integration tests.
 * Avoids hitting the rate-limited /auth/login endpoint.
 */
export function mintToken(userId: string, role: 'ADMIN' | 'AGENT'): string {
  return jwt.sign({ sub: userId, role }, config.jwt.secret, {
    expiresIn: '1h',
  } as jwt.SignOptions);
}

/**
 * Create a ticket via the API and return the supertest Response.
 * Caller should assert `res.status === 201` before reading `res.body.data.id`.
 */
export async function createTicketViaApi(
  app: Express,
  token: string,
  overrides?: { title?: string; description?: string; priority?: string },
): Promise<request.Response> {
  return request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Test Ticket',
      description: 'Test description',
      ...overrides,
    });
}

/**
 * Create a comment via the API and return the supertest Response.
 * Caller should assert `res.status === 201` before reading `res.body.data.id`.
 */
export async function createCommentViaApi(
  app: Express,
  ticketId: string,
  token: string,
  message?: string,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/tickets/${ticketId}/comments`)
    .set('Authorization', `Bearer ${token}`)
    .field('message', message ?? 'Test comment');
}
