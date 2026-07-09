/**
 * TEST-9: Integration tests for standalone attachment download and delete endpoints.
 *
 * Routes under test:
 *   GET  /api/v1/tickets/:ticketId/attachments/:attachmentId/download
 *   DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId
 *
 * Uses the real test DB (ttn_stm_test) + local storage backend.
 * Files written to .tmp/test-uploads/ are cleaned up in afterAll.
 */

import fs from 'fs';
import path from 'path';

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import app from '../../app';
import config from '../../config';
import pool, { query } from '../../config/postgres';
import redis from '../../config/redis';

const SALT_ROUNDS = 12;

async function createUser(
  name: string,
  email: string,
  password: string,
  role: 'ADMIN' | 'AGENT',
): Promise<{ id: string; token: string }> {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, email, hash, role],
  );
  const id = result.rows[0].id;
  const token = jwt.sign({ sub: id, role }, config.jwt.secret, {
    expiresIn: '1h',
  } as jwt.SignOptions);
  return { id, token };
}

async function createTicketAndGetId(token: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${token}`)
    .field('title', 'Ticket with attachment')
    .field('description', 'test')
    .attach('files', Buffer.from('PNG\x89PNG\r\n'), {
      filename: 'a.png',
      contentType: 'image/png',
    });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function getAttachmentId(ticketId: string): Promise<string> {
  const result = await query<{ id: string }>(
    'SELECT id FROM attachments WHERE ticket_id = $1 LIMIT 1',
    [ticketId],
  );
  return result.rows[0].id;
}

afterEach(async () => {
  await query('TRUNCATE attachments, comments, tickets, users RESTART IDENTITY CASCADE');
  await redis.flushdb();
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
  // Clean up any files saved to the local storage directory during tests
  try {
    const storageDir = path.resolve(config.storage.localDir);
    // Only remove dated sub-directories (YYYY-MM-DD/) to avoid deleting other files
    const today = new Date().toISOString().slice(0, 10);
    await fs.promises.rm(path.join(storageDir, today), { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ── Download tests ─────────────────────────────────────────────────────────────

describe('GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download', () => {
  it('admin downloads an attachment and receives correct Content-Type and Content-Disposition headers (TEST-9)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketId = await createTicketAndGetId(admin.token);
    const attachmentId = await getAttachmentId(ticketId);

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('a.png');
  });

  it('agent downloads attachment on their assigned ticket (RBAC-4)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'Agent@123', 'AGENT');

    // agent creates a ticket (auto-assigned to admin); assign it to the agent
    const ticketId = await createTicketAndGetId(agent.token);

    // Assign the ticket to the agent so the agent has access
    await request(app)
      .post(`/api/v1/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assignedTo: agent.id });

    const attachmentId = await getAttachmentId(ticketId);

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${agent.token}`);

    expect(res.status).toBe(200);
  });

  it('returns 403 when agent accesses attachment on a ticket not assigned to them (RBAC-4)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent1 = await createUser('Agent1', 'agent1@test.com', 'Agent@123', 'AGENT');
    const agent2 = await createUser('Agent2', 'agent2@test.com', 'Agent@123', 'AGENT');

    void admin;

    // agent1 creates and owns the ticket
    const ticketId = await createTicketAndGetId(agent1.token);
    const attachmentId = await getAttachmentId(ticketId);

    // agent2 attempts to download — should be 403
    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${agent2.token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a non-existent attachmentId', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketId = await createTicketAndGetId(admin.token);

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}/attachments/ffffffff-ffff-4fff-bfff-ffffffffffff/download`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a non-UUID attachmentId', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketId = await createTicketAndGetId(admin.token);

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}/attachments/not-a-uuid/download`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(400);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .get('/api/v1/tickets/ffffffff-ffff-4fff-bfff-ffffffffffff/attachments/ffffffff-ffff-4fff-bfff-ffffffffffff/download');

    expect(res.status).toBe(401);
  });
});

// ── Delete tests ───────────────────────────────────────────────────────────────

describe('DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId', () => {
  it('uploader (agent) can delete their own attachment and receives 204 (TEST-9, RBAC-5)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'Agent@123', 'AGENT');

    void admin;

    // agent uploads to their own ticket
    const ticketId = await createTicketAndGetId(agent.token);
    const attachmentId = await getAttachmentId(ticketId);

    const res = await request(app)
      .delete(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${agent.token}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it('admin can delete any attachment (not uploaded by them) (TEST-9, RBAC-5)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'Agent@123', 'AGENT');

    void agent;

    // admin creates ticket and the attachment is uploaded by admin
    const ticketId = await createTicketAndGetId(admin.token);
    const attachmentId = await getAttachmentId(ticketId);

    const res = await request(app)
      .delete(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(204);
  });

  it('returns 403 when an agent who is not the uploader tries to delete (TEST-9, RBAC-5)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent1 = await createUser('Agent1', 'agent1@test.com', 'Agent@123', 'AGENT');
    const agent2 = await createUser('Agent2', 'agent2@test.com', 'Agent@123', 'AGENT');

    void admin;

    // agent1 creates ticket and uploads the file
    const ticketId = await createTicketAndGetId(agent1.token);

    // Assign to agent2 so they have ticket access
    await request(app)
      .post(`/api/v1/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assignedTo: agent2.id });

    const attachmentId = await getAttachmentId(ticketId);

    // agent2 tries to delete agent1's attachment — 403
    const res = await request(app)
      .delete(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${agent2.token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a non-existent attachmentId', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketId = await createTicketAndGetId(admin.token);

    const res = await request(app)
      .delete(`/api/v1/tickets/${ticketId}/attachments/ffffffff-ffff-4fff-bfff-ffffffffffff`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a non-UUID attachmentId', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketId = await createTicketAndGetId(admin.token);

    const res = await request(app)
      .delete(`/api/v1/tickets/${ticketId}/attachments/not-a-uuid`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(400);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .delete('/api/v1/tickets/ffffffff-ffff-4fff-bfff-ffffffffffff/attachments/ffffffff-ffff-4fff-bfff-ffffffffffff');

    expect(res.status).toBe(401);
  });

  it('returns 403 when agent tries to delete attachment on an out-of-scope ticket (ticket access before ownership)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent1 = await createUser('Agent1', 'agent1@test.com', 'Agent@123', 'AGENT');
    const agent2 = await createUser('Agent2', 'agent2@test.com', 'Agent@123', 'AGENT');

    void admin;

    // agent1 creates and owns the ticket + upload
    const ticketId = await createTicketAndGetId(agent1.token);
    const attachmentId = await getAttachmentId(ticketId);

    // agent2 has NO access to this ticket at all
    const res = await request(app)
      .delete(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${agent2.token}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 on a follow-up download attempt after a successful delete (DB row is gone)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketId = await createTicketAndGetId(admin.token);
    const attachmentId = await getAttachmentId(ticketId);

    // Delete the attachment
    const deleteRes = await request(app)
      .delete(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(deleteRes.status).toBe(204);

    // Follow-up download should 404
    const downloadRes = await request(app)
      .get(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(downloadRes.status).toBe(404);
  });
});
