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
  // Sign token directly — avoids hitting the rate-limited /auth/login endpoint
  const token = jwt.sign({ sub: id, role }, config.jwt.secret, {
    expiresIn: '1h',
  } as jwt.SignOptions);
  return { id, token };
}

async function createTicket(token: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Test Ticket', description: 'Test description', ...overrides });
}

afterEach(async () => {
  await query('TRUNCATE attachments, comments, tickets, users RESTART IDENTITY CASCADE');
  await redis.flushdb();
});

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

// TEST-2: createTicket auto-assigns to admin with OPEN status
describe('POST /api/v1/tickets', () => {
  it('creates ticket, assigns to admin, sets status OPEN', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'Agent@123', 'AGENT');

    const res = await createTicket(agent.token, { title: 'New Ticket', description: 'Details' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.assignedTo).toBe(admin.id);
    expect(res.body.data.createdBy).toBe(agent.id);
  });

  it('admin can also create a ticket', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const res = await createTicket(admin.token);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/v1/tickets').send({ title: 'T', description: 'D' });

    expect(res.status).toBe(401);
  });

  it('returns 400 for missing title', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ description: 'No title here' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for empty description', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ title: 'Valid', description: '   ' });

    expect(res.status).toBe(400);
  });

  // TEST-9: ticket-level attachments on create
  it('accepts image/png and image/jpeg files on create and returns attachments with url, no storageKey', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('title', 'Ticket with files')
      .field('description', 'has attachments')
      .attach('files', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' })
      .attach('files', Buffer.from('fake jpg bytes'), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toHaveLength(2);
    for (const attachment of res.body.data.attachments) {
      expect(attachment).not.toHaveProperty('storageKey');
      expect(typeof attachment.url).toBe('string');
    }
  });

  it('rejects an attachment with a disallowed MIME type on create with 415', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('title', 'Ticket with bad file')
      .field('description', 'bad attachment')
      .attach('files', Buffer.from('fake pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(415);
  });

  it('rejects more files than the configured per-request limit with 400', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    let req = request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('title', 'Too many files')
      .field('description', 'over count');

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

// TEST-3: RBAC scoping — admin sees all, agent sees only own
describe('GET /api/v1/tickets', () => {
  it('admin sees all tickets', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent1 = await createUser('Agent1', 'agent1@test.com', 'Agent@123', 'AGENT');
    const agent2 = await createUser('Agent2', 'agent2@test.com', 'Agent@123', 'AGENT');

    await createTicket(agent1.token);
    await createTicket(agent2.token);

    const res = await request(app)
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
  });

  it('agent sees only own tickets (assigned or created)', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent1 = await createUser('Agent1', 'agent1@test.com', 'Agent@123', 'AGENT');
    const agent2 = await createUser('Agent2', 'agent2@test.com', 'Agent@123', 'AGENT');

    // agent1 creates 2 tickets (auto-assigned to admin)
    await createTicket(agent1.token, { title: 'Ticket A' });
    await createTicket(agent1.token, { title: 'Ticket B' });

    // agent2 creates 1 ticket
    await createTicket(agent2.token, { title: 'Ticket C' });

    const res = await request(app)
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${agent1.token}`);

    expect(res.status).toBe(200);
    // agent1 created 2 tickets (also createdBy = agent1)
    expect(res.body.data.total).toBe(2);
    const titles: string[] = res.body.data.tickets.map((t: { title: string }) => t.title);
    expect(titles).toContain('Ticket A');
    expect(titles).toContain('Ticket B');
    expect(titles).not.toContain('Ticket C');

    void admin; // used in DB via createUser
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/tickets');
    expect(res.status).toBe(401);
  });
});

// GET /api/v1/tickets/:id
describe('GET /api/v1/tickets/:id', () => {
  it('admin can fetch any ticket', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketRes = await createTicket(admin.token);
    const ticketId: string = ticketRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ticketId);
  });

  it('agent can fetch their own ticket', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'Agent@123', 'AGENT');
    const ticketRes = await createTicket(agent.token);
    const ticketId: string = ticketRes.body.data.id;

    void admin;

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${agent.token}`);

    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent ticket', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const res = await request(app)
      .get('/api/v1/tickets/ffffffff-ffff-4fff-bfff-ffffffffffff')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 403 when agent accesses ticket outside their scope', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent1 = await createUser('Agent1', 'agent1@test.com', 'Agent@123', 'AGENT');
    const agent2 = await createUser('Agent2', 'agent2@test.com', 'Agent@123', 'AGENT');

    const ticketRes = await createTicket(agent1.token);
    const ticketId: string = ticketRes.body.data.id;

    void admin;

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${agent2.token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 400 for invalid UUID', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const res = await request(app)
      .get('/api/v1/tickets/not-a-uuid')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(400);
  });

  // TEST-9: ticket detail embeds the full attachments array
  it('embeds attachments array on ticket detail, with no storageKey leaked', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const createRes = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('title', 'Ticket with files')
      .field('description', 'has attachments')
      .attach('files', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' });

    const ticketId: string = createRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(res.body.data.attachments[0]).not.toHaveProperty('storageKey');
    expect(typeof res.body.data.attachments[0].url).toBe('string');
  });

  it('returns 403 for out-of-scope agent even when the ticket has attachments', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent1 = await createUser('Agent1', 'agent1@test.com', 'Agent@123', 'AGENT');
    const agent2 = await createUser('Agent2', 'agent2@test.com', 'Agent@123', 'AGENT');

    void admin;

    const createRes = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${agent1.token}`)
      .field('title', 'Ticket with files')
      .field('description', 'has attachments')
      .attach('files', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' });

    const ticketId: string = createRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${agent2.token}`);

    expect(res.status).toBe(403);
  });
});

// TEST-1: State machine transitions
describe('PATCH /api/v1/tickets/:id/status', () => {
  it.each([
    ['OPEN', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'RESOLVED'],
    ['RESOLVED', 'CLOSED'],
    ['OPEN', 'CANCELLED'],
    ['IN_PROGRESS', 'CANCELLED'],
  ] as [string, string][])('valid transition %s → %s returns 200', async (from, to) => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketRes = await createTicket(admin.token);
    const ticketId: string = ticketRes.body.data.id;

    // Bring ticket to the `from` status via intermediate transitions
    const path: Record<string, string[]> = {
      OPEN: [],
      IN_PROGRESS: ['IN_PROGRESS'],
      RESOLVED: ['IN_PROGRESS', 'RESOLVED'],
      CLOSED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      CANCELLED: [],
    };

    for (const step of path[from] ?? []) {
      await request(app)
        .patch(`/api/v1/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: step });
    }

    const res = await request(app)
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: to });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(to);
  });

  it.each([
    ['OPEN', 'CLOSED'],
    ['OPEN', 'RESOLVED'],
    ['IN_PROGRESS', 'OPEN'],
    ['RESOLVED', 'IN_PROGRESS'],
    ['CLOSED', 'OPEN'],
  ] as [string, string][])(
    'invalid transition %s → %s returns 409 INVALID_STATUS_TRANSITION',
    async (from, to) => {
      const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
      const ticketRes = await createTicket(admin.token);
      const ticketId: string = ticketRes.body.data.id;

      const path: Record<string, string[]> = {
        OPEN: [],
        IN_PROGRESS: ['IN_PROGRESS'],
        RESOLVED: ['IN_PROGRESS', 'RESOLVED'],
        CLOSED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      };

      for (const step of path[from] ?? []) {
        await request(app)
          .patch(`/api/v1/tickets/${ticketId}/status`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ status: step });
      }

      const res = await request(app)
        .patch(`/api/v1/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: to });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
    },
  );
});

// TEST-4: Assignment
describe('POST /api/v1/tickets/:id/assign', () => {
  it('returns 403 when agent calls assign', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'Agent@123', 'AGENT');

    const ticketRes = await createTicket(admin.token);
    const ticketId: string = ticketRes.body.data.id;

    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send({ assignedTo: agent.id });

    expect(res.status).toBe(403);
  });

  it('returns 400 USER_NOT_FOUND for non-existent target user', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const ticketRes = await createTicket(admin.token);
    const ticketId: string = ticketRes.body.data.id;

    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assignedTo: 'ffffffff-ffff-4fff-bfff-ffffffffffff' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  it('admin can reassign a ticket to a valid agent', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const agent = await createUser('Agent', 'agent@test.com', 'Agent@123', 'AGENT');

    const ticketRes = await createTicket(admin.token);
    const ticketId: string = ticketRes.body.data.id;

    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assignedTo: agent.id });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedTo).toBe(agent.id);
  });
});

// PATCH /api/v1/tickets/:id — field updates
describe('PATCH /api/v1/tickets/:id', () => {
  it('updates title and priority', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketRes = await createTicket(admin.token);
    const ticketId: string = ticketRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ title: 'Updated Title', priority: 'HIGH' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated Title');
    expect(res.body.data.priority).toBe('HIGH');
  });

  it('returns 400 when no fields are provided', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');
    const ticketRes = await createTicket(admin.token);
    const ticketId: string = ticketRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  // TEST-9: additional ticket-level attachments via update
  it('accumulates attachments across create and update calls', async () => {
    const admin = await createUser('Admin', 'admin@test.com', 'Admin@123', 'ADMIN');

    const createRes = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('title', 'Ticket with files')
      .field('description', 'has attachments')
      .attach('files', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' });

    const ticketId: string = createRes.body.data.id;

    await request(app)
      .patch(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('priority', 'HIGH')
      .attach('files', Buffer.from('fake jpg bytes'), { filename: 'b.jpg', contentType: 'image/jpeg' });

    const res = await request(app)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(2);
  });
});
