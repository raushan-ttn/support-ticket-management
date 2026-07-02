import { query } from '../../config/postgres';
import { deleteCache, getCache, setCache } from '../../config/redis';
import { autoCloseQueue, emailQueue } from '../../jobs/queues';
import { buildStorageKey, getStorageBackend } from '../../storage';
import { getTicketById } from '../tickets/ticket.service';
import { addComment, getCommentById, listComments } from './comment.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../config/postgres', () => ({ query: jest.fn() }));

jest.mock('../../config/redis', () => ({
  getCache: jest.fn(),
  setCache: jest.fn(),
  deleteCache: jest.fn(),
}));

jest.mock('../../jobs/queues', () => ({
  emailQueue: { add: jest.fn() },
  autoCloseQueue: { add: jest.fn(), getJob: jest.fn() },
}));

jest.mock('../../storage', () => ({
  buildStorageKey: jest.fn(),
  getStorageBackend: jest.fn(),
}));

jest.mock('../tickets/ticket.service', () => ({ getTicketById: jest.fn() }));

// ── Typed mock refs ────────────────────────────────────────────────────────────

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockGetCache = getCache as jest.MockedFunction<typeof getCache>;
const mockSetCache = setCache as jest.MockedFunction<typeof setCache>;
const mockDeleteCache = deleteCache as jest.MockedFunction<typeof deleteCache>;
const mockEmailQueueAdd = emailQueue.add as jest.MockedFunction<typeof emailQueue.add>;
const mockAutoCloseQueueAdd = autoCloseQueue.add as jest.MockedFunction<
  typeof autoCloseQueue.add
>;
const mockAutoCloseQueueGetJob = autoCloseQueue.getJob as jest.MockedFunction<
  typeof autoCloseQueue.getJob
>;
const mockBuildStorageKey = buildStorageKey as jest.MockedFunction<typeof buildStorageKey>;
const mockGetStorageBackend = getStorageBackend as jest.MockedFunction<typeof getStorageBackend>;
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
  screenshot: null,
  priority: 'MEDIUM' as const,
  status: 'OPEN' as const,
  assignedTo: AGENT_ID,
  createdBy: ADMIN_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockCommentRow = {
  id: COMMENT_ID,
  ticketId: TICKET_ID,
  message: 'This is a comment',
  screenshot: null,
  createdBy: AGENT_ID,
  createdByName: 'Agent User',
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTicketById.mockResolvedValue(mockTicket);
  mockGetCache.mockResolvedValue(null);
  mockSetCache.mockResolvedValue(undefined);
  mockDeleteCache.mockResolvedValue(undefined);
  mockEmailQueueAdd.mockResolvedValue({ id: 'job-1' } as never);
  mockAutoCloseQueueAdd.mockResolvedValue({ id: 'job-2' } as never);
  mockAutoCloseQueueGetJob.mockResolvedValue(undefined);
});

// ── addComment ─────────────────────────────────────────────────────────────────

describe('addComment', () => {
  it('inserts comment without screenshot and returns CommentRow', async () => {
    // admin lookup for queue payload
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCommentRow], rowCount: 1 } as never) // CTE insert+select
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never); // admin lookup

    const result = await addComment(TICKET_ID, 'This is a comment', undefined, AGENT_ID, 'AGENT');

    expect(result).toMatchObject({ id: COMMENT_ID, message: 'This is a comment' });
    expect(mockDeleteCache).toHaveBeenCalledWith(`ticket:${TICKET_ID}:comments`);
  });

  it('throws 415 when file has disallowed MIME type', async () => {
    const badFile = {
      mimetype: 'text/plain',
      buffer: Buffer.from('hello'),
      size: 5,
    } as Express.Multer.File;

    await expect(
      addComment(TICKET_ID, 'hello', badFile, AGENT_ID, 'AGENT'),
    ).rejects.toMatchObject({ statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('saves screenshot and stores key in DB when file is jpeg', async () => {
    const storageKey = '2026-07-01/test-uuid';
    const mockSave = jest.fn().mockResolvedValue(undefined);
    mockBuildStorageKey.mockReturnValue(storageKey);
    mockGetStorageBackend.mockResolvedValue({ save: mockSave } as never);

    const fileWithScreenshot = {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('jpeg-data'),
      size: 9,
    } as Express.Multer.File;

    const commentWithScreenshot = { ...mockCommentRow, screenshot: storageKey };
    mockQuery
      .mockResolvedValueOnce({ rows: [commentWithScreenshot], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never);

    const result = await addComment(
      TICKET_ID,
      'Comment with screenshot',
      fileWithScreenshot,
      AGENT_ID,
      'AGENT',
    );

    expect(mockSave).toHaveBeenCalledWith(storageKey, expect.anything(), 'image/jpeg', 9);
    expect(result.screenshot).toBe(storageKey);
    // Verify storage key is passed to DB insert as $3
    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[1]?.[2]).toBe(storageKey);
  });

  it('schedules auto-close job when assignee comments on non-terminal ticket', async () => {
    const assigneeTicket = { ...mockTicket, assignedTo: AGENT_ID, status: 'IN_PROGRESS' as const };
    mockGetTicketById.mockResolvedValue(assigneeTicket);

    mockQuery
      .mockResolvedValueOnce({ rows: [mockCommentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never);

    await addComment(TICKET_ID, 'Assignee reply', undefined, AGENT_ID, 'AGENT');

    expect(mockAutoCloseQueueAdd).toHaveBeenCalledWith(
      'auto-close',
      expect.objectContaining({ ticketId: TICKET_ID, assigneeId: AGENT_ID }),
      expect.objectContaining({ jobId: `auto-close:${TICKET_ID}` }),
    );
  });

  it('cancels pending auto-close job when creator replies', async () => {
    // assignedTo must differ from callerId so the assignee branch is NOT taken
    const creatorTicket = {
      ...mockTicket,
      createdBy: AGENT_ID,
      assignedTo: ADMIN_ID, // different from callerId (AGENT_ID)
      status: 'IN_PROGRESS' as const,
    };
    mockGetTicketById.mockResolvedValue(creatorTicket);

    const mockJobRemove = jest.fn().mockResolvedValue(undefined);
    mockAutoCloseQueueGetJob.mockResolvedValue({ remove: mockJobRemove } as never);

    mockQuery
      .mockResolvedValueOnce({ rows: [mockCommentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never);

    await addComment(TICKET_ID, 'Creator reply', undefined, AGENT_ID, 'AGENT');

    expect(mockAutoCloseQueueGetJob).toHaveBeenCalledWith(`auto-close:${TICKET_ID}`);
    expect(mockJobRemove).toHaveBeenCalled();
  });

  it('does NOT schedule auto-close when ticket is already in terminal status', async () => {
    const closedTicket = { ...mockTicket, assignedTo: AGENT_ID, status: 'RESOLVED' as const };
    mockGetTicketById.mockResolvedValue(closedTicket);

    mockQuery
      .mockResolvedValueOnce({ rows: [mockCommentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never);

    await addComment(TICKET_ID, 'Comment on resolved ticket', undefined, AGENT_ID, 'AGENT');

    expect(mockAutoCloseQueueAdd).not.toHaveBeenCalled();
  });

  it('does not re-throw when queue add fails (fire-and-forget)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCommentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID }], rowCount: 1 } as never);
    mockEmailQueueAdd.mockRejectedValue(new Error('Redis unavailable'));

    // Should resolve normally despite queue failure
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
