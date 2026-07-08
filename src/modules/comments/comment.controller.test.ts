import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import app from '../../app';
import config from '../../config';
import pool, { query } from '../../config/postgres';
import redis from '../../config/redis';

const SALT_ROUNDS = 12;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createUser(
  name: string,
  email: string,
  role: 'ADMIN' | 'AGENT',
): Promise<{ id: string; token: string }> {
  const hash = await bcrypt.hash('Test@123', SALT_ROUNDS);
  const result = await query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, email, hash, role],
  );
  const id = result.rows[0].id;
  const token = jwt.sign({ sub: id, role }, config.jwt.secret, {
    expiresIn: '1h',
  } as jwt.SignOptions);
  return { id, token };
}

async function createTicketInDb(
  token: string,
  adminId: string,
): Promise<{ id: string }> {
  const res = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Test Ticket', description: 'Test description' });

  // Reassign to admin so agents can comment
  await query('UPDATE tickets SET assigned_to = $1 WHERE id = $2', [adminId, res.body.data.id]);
  return { id: res.body.data.id };
}

afterEach(async () => {
  await query('TRUNCATE attachments, comments, tickets, users RESTART IDENTITY CASCADE');
  await redis.flushdb();
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

// ── POST /:ticketId/comments ──────────────────────────────────────────────────

describe('POST /api/v1/tickets/:ticketId/comments', () => {
  it('returns 201 with comment data on valid message', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'Hello from admin');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe('Hello from admin');
    expect(res.body.data.screenshot).toBeNull();
    expect(res.body.data.ticketId).toBe(ticket.id);
    expect(res.body.data.createdBy).toBe(admin.id);
    // storageKey must never appear in the response
    expect(res.body.data).not.toHaveProperty('storageKey');
  });

  it('returns 400 for empty or missing message', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', '   ');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/v1/tickets/cccccccc-0000-0000-0000-000000000003/comments')
      .field('message', 'hello');

    expect(res.status).toBe(401);
  });

  it('returns 400 for non-UUID ticketId', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');

    const res = await request(app)
      .post('/api/v1/tickets/not-a-uuid/comments')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'hello');

    expect(res.status).toBe(400);
  });

  it('returns 404 when ticket does not exist', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const fakeId = 'ffffffff-ffff-4fff-afff-ffffffffffff';

    const res = await request(app)
      .post(`/api/v1/tickets/${fakeId}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'hello');

    expect(res.status).toBe(404);
  });

  it('returns 403 when agent comments on ticket not assigned to them', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'AGENT');
    const otherAgent = await createUser('OtherAgent', 'other@test.com', 'AGENT');

    // Ticket assigned to agent, not otherAgent
    const ticket = await createTicketInDb(admin.token, agent.id);
    await query('UPDATE tickets SET assigned_to = $1 WHERE id = $2', [agent.id, ticket.id]);

    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${otherAgent.token}`)
      .field('message', 'sneaky comment');

    expect(res.status).toBe(403);
  });

  it('rejects unsupported file MIME type with 415', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'with bad file')
      .attach('screenshot', Buffer.from('fake pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(415);
  });

  // TEST-9: comment-level attachments
  it('accepts image/png and image/jpeg files as attachments and returns them with a url, no storageKey', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'with attachments')
      .attach('files', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' })
      .attach('files', Buffer.from('fake jpg bytes'), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toHaveLength(2);
    for (const attachment of res.body.data.attachments) {
      expect(attachment).not.toHaveProperty('storageKey');
      expect(typeof attachment.url).toBe('string');
      expect(attachment.commentId).toBe(res.body.data.id);
    }
  });

  it('rejects an attachment with a disallowed MIME type via the files field with 415', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'bad attachment')
      .attach('files', Buffer.from('fake pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(415);
  });

  it('rejects more attachment files than the configured per-request limit with 400', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    let req = request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'too many files');

    for (let i = 0; i < config.attachment.maxFilesPerRequest + 1; i++) {
      req = req.attach('files', Buffer.from('fake png bytes'), {
        filename: `f${i}.png`,
        contentType: 'image/png',
      });
    }

    const res = await req;

    expect(res.status).toBe(400);
  });
});

// ── GET /:ticketId/comments ───────────────────────────────────────────────────

describe('GET /api/v1/tickets/:ticketId/comments', () => {
  it('returns 200 with empty array when no comments', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns list ordered by createdAt ASC', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    // Add two comments in order
    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'First comment');

    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'Second comment');

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].message).toBe('First comment');
    expect(res.body.data[1].message).toBe('Second comment');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get(
      '/api/v1/tickets/cccccccc-0000-0000-0000-000000000003/comments',
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 for agent viewing out-of-scope ticket', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'AGENT');
    const otherAgent = await createUser('OtherAgent', 'other@test.com', 'AGENT');

    const ticket = await createTicketInDb(admin.token, agent.id);
    await query('UPDATE tickets SET assigned_to = $1 WHERE id = $2', [agent.id, ticket.id]);

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${otherAgent.token}`);

    expect(res.status).toBe(403);
  });

  // TEST-9: each comment embeds its own attachments array, with no cross-comment leakage
  it('embeds a per-comment attachments array with no cross-comment leakage', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'no attachment');

    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'has attachment')
      .attach('files', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' });

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].attachments).toEqual([]);
    expect(res.body.data[1].attachments).toHaveLength(1);
    expect(res.body.data[1].attachments[0]).not.toHaveProperty('storageKey');
  });
});

// ── GET /:ticketId/comments/:commentId ────────────────────────────────────────

describe('GET /api/v1/tickets/:ticketId/comments/:commentId', () => {
  it('returns 200 with single comment', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const addRes = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'Single comment');

    const commentId = addRes.body.data.id as string;

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/comments/${commentId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(commentId);
    expect(res.body.data.message).toBe('Single comment');
  });

  it('returns 404 for non-existent commentId', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);
    const fakeCommentId = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee';

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/comments/${fakeCommentId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('INVALID_COMMENT_REFERENCE');
  });

  it('returns 400 for non-UUID commentId', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/comments/not-a-uuid`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const fakeTicketId = 'cccccccc-0000-0000-0000-000000000003';
    const fakeCommentId = 'dddddddd-0000-0000-0000-000000000004';

    const res = await request(app).get(
      `/api/v1/tickets/${fakeTicketId}/comments/${fakeCommentId}`,
    );

    expect(res.status).toBe(401);
  });

  // TEST-9: single comment fetch embeds its attachments array
  it('embeds attachments array on a single comment fetch', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'ADMIN');
    const ticket = await createTicketInDb(admin.token, admin.id);

    const addRes = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('message', 'with attachment')
      .attach('files', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' });

    const commentId = addRes.body.data.id as string;

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/comments/${commentId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(res.body.data.attachments[0]).not.toHaveProperty('storageKey');
  });
});
