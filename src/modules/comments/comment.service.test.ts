import { query } from '../../config/postgres';
import { deleteCache, getCache, setCache } from '../../config/redis';
import { sendCommentNotificationEmail } from '../../jobs/notifications';
import { getTicketById } from '../tickets/ticket.service';
import { addComment, getCommentById, listComments } from './comment.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../config/postgres', () => ({ query: jest.fn() }));

jest.mock('../../config/redis', () => ({
  getCache: jest.fn(),
  setCache: jest.fn(),
  deleteCache: jest.fn(),
}));

jest.mock('../../jobs/notifications', () => ({
  sendCommentNotificationEmail: jest.fn(),
}));

jest.mock('../tickets/ticket.service', () => ({ getTicketById: jest.fn() }));

jest.mock('../attachments/attachment.service', () => ({
  uploadAttachments: jest.fn().mockResolvedValue([]),
  getAttachmentsByComment: jest.fn().mockResolvedValue([]),
  toAttachmentUrl: jest.fn((key: string) => `/${key}`),
}));

// ── Typed mock refs ────────────────────────────────────────────────────────────

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockGetCache = getCache as jest.MockedFunction<typeof getCache>;
const mockSetCache = setCache as jest.MockedFunction<typeof setCache>;
const mockDeleteCache = deleteCache as jest.MockedFunction<typeof deleteCache>;
const mockSendCommentNotificationEmail = sendCommentNotificationEmail as jest.MockedFunction<
  typeof sendCommentNotificationEmail
>;
const mockGetTicketById = getTicketById as jest.MockedFunction<typeof getTicketById>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const AGENT_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const TICKET_ID = 'cccccccc-0000-0000-0000-000000000003';
const COMMENT_ID = 'dddddddd-0000-0000-0000-000000000004';

const mockTicket = {
  id: TICKET_ID,
  title: 'Test Ticket',
  description: 'Test description',
  type: null,
  subType: null,
  priority: 'MEDIUM' as const,
  status: 'OPEN' as const,
  assignedTo: AGENT_ID,
  createdBy: ADMIN_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  attachments: [],
};

const mockCommentRow = {
  id: COMMENT_ID,
  ticketId: TICKET_ID,
  message: 'This is a comment',
  createdBy: AGENT_ID,
  createdByName: 'Agent User',
  createdAt: new Date().toISOString(),
  attachments: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTicketById.mockResolvedValue(mockTicket);
  mockGetCache.mockResolvedValue(null);
  mockSetCache.mockResolvedValue(undefined);
  mockDeleteCache.mockResolvedValue(undefined);
  mockSendCommentNotificationEmail.mockResolvedValue(undefined);
});

// ── addComment ─────────────────────────────────────────────────────────────────

describe('addComment', () => {
  it('inserts comment and returns CommentRow', async () => {
    // admin lookup for queue payload
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCommentRow], rowCount: 1 } as never) // CTE insert+select
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never); // admin lookup

    const result = await addComment(TICKET_ID, 'This is a comment', undefined, AGENT_ID, 'AGENT');

    expect(result).toMatchObject({ id: COMMENT_ID, message: 'This is a comment' });
    expect(mockDeleteCache).toHaveBeenCalledWith(`ticket:${TICKET_ID}:comments`);
  });

  it('sends comment-notification email with correct payload', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCommentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never);

    await addComment(TICKET_ID, 'This is a comment', undefined, AGENT_ID, 'AGENT');

    expect(mockSendCommentNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: TICKET_ID, commentAuthorId: AGENT_ID }),
    );
  });

  it('does not re-throw when notification send fails (fire-and-forget)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCommentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never);
    mockSendCommentNotificationEmail.mockRejectedValue(new Error('SMTP unavailable'));

    // Should resolve normally despite notification failure
    await expect(
      addComment(TICKET_ID, 'This is a comment', undefined, AGENT_ID, 'AGENT'),
    ).resolves.toMatchObject({ id: COMMENT_ID });
  });

  it('throws 500 if DB insert returns no row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(
      addComment(TICKET_ID, 'This is a comment', undefined, AGENT_ID, 'AGENT'),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('propagates 403 when getTicketById denies access', async () => {
    const forbidden = Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'FORBIDDEN' });
    mockGetTicketById.mockRejectedValue(forbidden);

    await expect(
      addComment(TICKET_ID, 'hello', undefined, AGENT_ID, 'AGENT'),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ── listComments ───────────────────────────────────────────────────────────────

describe('listComments', () => {
  it('returns cached list when cache is warm', async () => {
    mockGetCache.mockResolvedValue([mockCommentRow]);

    const result = await listComments(TICKET_ID, ADMIN_ID, 'ADMIN');

    expect(result).toEqual([mockCommentRow]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('queries DB and caches result on cache miss', async () => {
    mockGetCache.mockResolvedValue(null);
    mockQuery.mockResolvedValue({ rows: [mockCommentRow], rowCount: 1 } as never);

    const result = await listComments(TICKET_ID, ADMIN_ID, 'ADMIN');

    expect(result).toEqual([mockCommentRow]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockSetCache).toHaveBeenCalledWith(
      `ticket:${TICKET_ID}:comments`,
      [mockCommentRow],
      expect.any(Number),
    );
  });

  it('gracefully degrades when cache read throws', async () => {
    mockGetCache.mockRejectedValue(new Error('Redis down'));
    mockQuery.mockResolvedValue({ rows: [mockCommentRow], rowCount: 1 } as never);

    const result = await listComments(TICKET_ID, ADMIN_ID, 'ADMIN');

    expect(result).toEqual([mockCommentRow]);
  });
});

// ── getCommentById ─────────────────────────────────────────────────────────────

describe('getCommentById', () => {
  it('returns comment when found', async () => {
    mockQuery.mockResolvedValue({ rows: [mockCommentRow], rowCount: 1 } as never);

    const result = await getCommentById(TICKET_ID, COMMENT_ID, ADMIN_ID, 'ADMIN');

    expect(result).toMatchObject({ id: COMMENT_ID, ticketId: TICKET_ID });
    // Ensure both commentId and ticketId are in the query params
    const queryParams = mockQuery.mock.calls[0][1] as unknown[];
    expect(queryParams).toContain(COMMENT_ID);
    expect(queryParams).toContain(TICKET_ID);
  });

  it('throws 404 with INVALID_COMMENT_REFERENCE when comment not found', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await expect(
      getCommentById(TICKET_ID, COMMENT_ID, ADMIN_ID, 'ADMIN'),
    ).rejects.toMatchObject({ statusCode: 404, code: 'INVALID_COMMENT_REFERENCE' });
  });

  it('propagates ticket-level 403 from getTicketById', async () => {
    const forbidden = Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'FORBIDDEN' });
    mockGetTicketById.mockRejectedValue(forbidden);

    await expect(
      getCommentById(TICKET_ID, COMMENT_ID, AGENT_ID, 'AGENT'),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
