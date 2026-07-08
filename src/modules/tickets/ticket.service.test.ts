import { query, withTransaction } from '../../config/postgres';
import { deleteCache, deleteCacheByPattern, getCache, setCache } from '../../config/redis';
import { getAttachmentsByTicket } from '../attachments/attachment.service';
import {
  assignTicket,
  createTicket,
  getTicketById,
  listTickets,
  transitionStatus,
} from './ticket.service';

jest.mock('../../config/postgres', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../../config/redis', () => ({
  getCache: jest.fn(),
  setCache: jest.fn(),
  deleteCache: jest.fn(),
  deleteCacheByPattern: jest.fn(),
}));

jest.mock('../attachments/attachment.service', () => ({
  getAttachmentsByTicket: jest.fn(),
  uploadAttachments: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWithTransaction = withTransaction as jest.MockedFunction<typeof withTransaction>;
const mockGetCache = getCache as jest.MockedFunction<typeof getCache>;
const mockSetCache = setCache as jest.MockedFunction<typeof setCache>;
const mockDeleteCache = deleteCache as jest.MockedFunction<typeof deleteCache>;
const mockDeleteCacheByPattern = deleteCacheByPattern as jest.MockedFunction<
  typeof deleteCacheByPattern
>;
const mockGetAttachmentsByTicket = getAttachmentsByTicket as jest.MockedFunction<
  typeof getAttachmentsByTicket
>;

const ADMIN_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const AGENT_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const TICKET_ID = 'cccccccc-0000-0000-0000-000000000003';

const mockTicket = {
  id: TICKET_ID,
  title: 'Test Ticket',
  description: 'Test description',
  type: null,
  subType: null,
  screenshot: null,
  priority: 'MEDIUM' as const,
  status: 'OPEN' as const,
  assignedTo: ADMIN_ID,
  createdBy: AGENT_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  attachments: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCache.mockResolvedValue(null);
  mockSetCache.mockResolvedValue(undefined);
  mockDeleteCache.mockResolvedValue(undefined);
  mockDeleteCacheByPattern.mockResolvedValue(undefined);
  mockGetAttachmentsByTicket.mockResolvedValue([]);
});

// TEST-2: createTicket ignores client status/assignedTo; auto-assigns to admin
describe('createTicket', () => {
  it('auto-assigns to first admin regardless of caller role', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never) // admin lookup
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }], rowCount: 1 } as never) // insert
      .mockResolvedValueOnce({ rows: [mockTicket], rowCount: 1 } as never); // select

    const result = await createTicket(
      { title: 'Test Ticket', description: 'Test description', priority: 'MEDIUM' },
      AGENT_ID,
    );

    expect(result.status).toBe('OPEN');
    expect(result.assignedTo).toBe(ADMIN_ID);

    // Verify INSERT used 'OPEN' and adminId — not client values
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO tickets/);
    expect(insertCall[1]).toContain(ADMIN_ID);
  });

  it('throws 500 when no admin user exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(
      createTicket({ title: 'T', description: 'D', priority: 'LOW' }, AGENT_ID),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

// TEST-5: Validation — Zod schema rejects missing/empty title or description
describe('createTicketSchema validation', () => {
  const { createTicketSchema } = jest.requireActual(
    './ticket.schemas',
  ) as typeof import('./ticket.schemas');

  it('rejects missing title', () => {
    const result = createTicketSchema.safeParse({ description: 'desc' });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = createTicketSchema.safeParse({ title: '   ', description: 'desc' });
    expect(result.success).toBe(false);
  });

  it('rejects missing description', () => {
    const result = createTicketSchema.safeParse({ title: 'My ticket' });
    expect(result.success).toBe(false);
  });

  it('rejects empty description', () => {
    const result = createTicketSchema.safeParse({ title: 'My ticket', description: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority enum', () => {
    const result = createTicketSchema.safeParse({
      title: 'T',
      description: 'D',
      priority: 'CRITICAL',
    });
    expect(result.success).toBe(false);
  });

  it('defaults priority to MEDIUM when omitted', () => {
    const result = createTicketSchema.safeParse({ title: 'T', description: 'D' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe('MEDIUM');
  });
});

// TEST-1: transitionStatus — state machine
describe('transitionStatus', () => {
  it.each([
    ['OPEN', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'RESOLVED'],
    ['RESOLVED', 'CLOSED'],
    ['OPEN', 'CANCELLED'],
    ['IN_PROGRESS', 'CANCELLED'],
  ])('allows valid transition %s → %s', async (from, to) => {
    mockWithTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ status: from, assigned_to: ADMIN_ID }], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [{ ...mockTicket, status: to }], rowCount: 1 }),
      };
      return fn(mockClient as never);
    });

    await expect(
      transitionStatus(TICKET_ID, to as never, ADMIN_ID, 'ADMIN'),
    ).resolves.toBeDefined();
  });

  it.each([
    ['OPEN', 'CLOSED'],
    ['OPEN', 'RESOLVED'],
    ['IN_PROGRESS', 'OPEN'],
    ['RESOLVED', 'OPEN'],
    ['RESOLVED', 'IN_PROGRESS'],
    ['CLOSED', 'OPEN'],
    ['CANCELLED', 'OPEN'],
  ])('rejects invalid transition %s → %s with 409', async (from, to) => {
    mockWithTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{ status: from, assigned_to: ADMIN_ID }],
          rowCount: 1,
        }),
      };
      return fn(mockClient as never);
    });

    await expect(transitionStatus(TICKET_ID, to as never, ADMIN_ID, 'ADMIN')).rejects.toMatchObject(
      { statusCode: 409, code: 'INVALID_STATUS_TRANSITION' },
    );
  });

  it('returns 404 when ticket does not exist', async () => {
    mockWithTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      };
      return fn(mockClient as never);
    });

    await expect(
      transitionStatus(TICKET_ID, 'IN_PROGRESS', ADMIN_ID, 'ADMIN'),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('returns 403 when agent is not assigned to the ticket', async () => {
    mockWithTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{ status: 'OPEN', assigned_to: ADMIN_ID }],
          rowCount: 1,
        }),
      };
      return fn(mockClient as never);
    });

    await expect(
      transitionStatus(TICKET_ID, 'IN_PROGRESS', AGENT_ID, 'AGENT'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});

// TEST-4 (service side): assignTicket — 400 when user not found
describe('assignTicket', () => {
  it('throws 400 USER_NOT_FOUND when target user does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(assignTicket(TICKET_ID, { assignedTo: AGENT_ID })).rejects.toMatchObject({
      statusCode: 400,
      code: 'USER_NOT_FOUND',
    });
  });

  it('throws 404 when ticket does not exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: AGENT_ID }], rowCount: 1 } as never) // user exists
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // ticket not found

    await expect(assignTicket(TICKET_ID, { assignedTo: AGENT_ID })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

// getTicketById — cache + scope
describe('getTicketById', () => {
  it('returns cached ticket for admin without DB query', async () => {
    // Cache stores TicketDbRow (no attachments field); service merges attachments from getAttachmentsByTicket
    const cachedDbRow = { ...mockTicket, attachments: undefined };
    mockGetCache.mockResolvedValueOnce(cachedDbRow);

    const result = await getTicketById(TICKET_ID, ADMIN_ID, 'ADMIN');
    expect(result).toMatchObject({ id: TICKET_ID, title: 'Test Ticket', attachments: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('falls back to DB on cache miss and populates cache', async () => {
    mockGetCache.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [mockTicket], rowCount: 1 } as never);

    const result = await getTicketById(TICKET_ID, ADMIN_ID, 'ADMIN');
    expect(result).toMatchObject({ id: TICKET_ID, title: 'Test Ticket', attachments: [] });
    // Cache stores the DB row shape (without attachments)
    expect(mockSetCache).toHaveBeenCalledWith(
      `ticket:${TICKET_ID}`,
      expect.objectContaining({ id: TICKET_ID }),
      expect.any(Number),
    );
  });

  it('throws 404 when ticket not found', async () => {
    mockGetCache.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(getTicketById(TICKET_ID, ADMIN_ID, 'ADMIN')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('throws 403 for agent accessing out-of-scope ticket', async () => {
    const otherAgent = 'xxxxxxxx-0000-0000-0000-000000000099';
    mockGetCache.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [mockTicket], rowCount: 1 } as never);

    await expect(getTicketById(TICKET_ID, otherAgent, 'AGENT')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });
});

// listTickets — RBAC scope in SQL
describe('listTickets', () => {
  beforeEach(() => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '5' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [mockTicket], rowCount: 1 } as never);
  });

  it('does not add scope WHERE clause for ADMIN', async () => {
    await listTickets(ADMIN_ID, 'ADMIN', {
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      order: 'desc',
    });

    const countSql = (mockQuery.mock.calls[0][0] as string).toLowerCase();
    expect(countSql).not.toContain('assigned_to');
  });

  it('adds scope WHERE clause for AGENT', async () => {
    await listTickets(AGENT_ID, 'AGENT', {
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      order: 'desc',
    });

    const countSql = (mockQuery.mock.calls[0][0] as string).toLowerCase();
    expect(countSql).toContain('assigned_to');
    expect(countSql).toContain('created_by');
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(AGENT_ID);
  });
});
