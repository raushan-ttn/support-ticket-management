/**
 * TEST-7: Direct-call unit tests for sendNewTicketEmail and sendCommentNotificationEmail.
 *
 * Strategy:
 * - Mock `query` from postgres to control email lookups without a real DB.
 * - Mock `getTransport()` from mailer.ts to return a fake transport with a
 *   jest.fn() sendMail — avoids any real SMTP connection regardless of NODE_ENV.
 * - Assert on sendMail call count and arguments.
 */

jest.mock('../config/postgres', () => ({ query: jest.fn() }));

// Mock the mailer module with a controllable sendMail spy
const mockSendMail = jest.fn();
jest.mock('./mailer', () => ({
  getTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

import { query } from '../config/postgres';
import { sendCommentNotificationEmail, sendNewTicketEmail } from './notifications';

const mockQuery = query as jest.MockedFunction<typeof query>;

const TICKET_ID = 'cccccccc-0000-0000-0000-000000000003';
const TICKET_TITLE = 'Test Ticket';
const CREATOR_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ADMIN_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'dddddddd-0000-0000-0000-000000000004';
const AUTHOR_ID = 'eeeeeeee-0000-0000-0000-000000000005';

function makeQueryRows(ids: string[], emails: string[]) {
  return {
    rows: ids.map((id, i) => ({ id, email: emails[i] })),
    rowCount: ids.length,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: sendMail resolves successfully
  mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });
});

// ── sendNewTicketEmail ──────────────────────────────────────────────────────────

describe('sendNewTicketEmail', () => {
  it('sends to both creator and admin when they are different users (FR-10)', async () => {
    mockQuery.mockResolvedValueOnce(
      makeQueryRows([CREATOR_ID, ADMIN_ID], ['creator@example.com', 'admin@example.com']),
    );

    await sendNewTicketEmail({
      ticketId: TICKET_ID,
      ticketTitle: TICKET_TITLE,
      creatorId: CREATOR_ID,
      adminId: ADMIN_ID,
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMail.mock.calls[0][0] as { to: string };
    expect(callArgs.to).toContain('creator@example.com');
    expect(callArgs.to).toContain('admin@example.com');
  });

  it('de-duplicates recipients when creator and admin are the same person (FR-10)', async () => {
    // resolveEmails deduplicates via Set — only one unique ID is queried
    mockQuery.mockResolvedValueOnce(makeQueryRows([CREATOR_ID], ['same@example.com']));

    await sendNewTicketEmail({
      ticketId: TICKET_ID,
      ticketTitle: TICKET_TITLE,
      creatorId: CREATOR_ID,
      adminId: CREATOR_ID, // same person
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMail.mock.calls[0][0] as { to: string };
    // Only one address — no duplicates
    const addresses = (callArgs.to as string).split(',').map((s) => s.trim());
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toBe('same@example.com');
  });

  it('does NOT call sendMail when no users are found (empty query result)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await sendNewTicketEmail({
      ticketId: TICKET_ID,
      ticketTitle: TICKET_TITLE,
      creatorId: CREATOR_ID,
      adminId: ADMIN_ID,
    });

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('resolves without re-throwing when sendMail throws (NFR-8 fire-and-forget)', async () => {
    mockQuery.mockResolvedValueOnce(
      makeQueryRows([CREATOR_ID, ADMIN_ID], ['creator@example.com', 'admin@example.com']),
    );
    mockSendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    await expect(
      sendNewTicketEmail({
        ticketId: TICKET_ID,
        ticketTitle: TICKET_TITLE,
        creatorId: CREATOR_ID,
        adminId: ADMIN_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves without re-throwing when query throws (NFR-8 fire-and-forget)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection error'));

    await expect(
      sendNewTicketEmail({
        ticketId: TICKET_ID,
        ticketTitle: TICKET_TITLE,
        creatorId: CREATOR_ID,
        adminId: ADMIN_ID,
      }),
    ).resolves.toBeUndefined();
  });
});

// ── sendCommentNotificationEmail ───────────────────────────────────────────────

describe('sendCommentNotificationEmail', () => {
  const baseData = {
    ticketId: TICKET_ID,
    ticketTitle: TICKET_TITLE,
    commentMessage: 'A comment was added',
    commentAuthorId: AUTHOR_ID,
    creatorId: CREATOR_ID,
    assigneeId: ASSIGNEE_ID,
    adminId: ADMIN_ID,
  };

  it('excludes comment author when author is the creator (FR-11)', async () => {
    // Author = CREATOR_ID; recipients should be ASSIGNEE + ADMIN
    const data = { ...baseData, commentAuthorId: CREATOR_ID };
    mockQuery.mockResolvedValueOnce(
      makeQueryRows([ASSIGNEE_ID, ADMIN_ID], ['assignee@example.com', 'admin@example.com']),
    );

    await sendCommentNotificationEmail(data);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMail.mock.calls[0][0] as { to: string };
    expect(callArgs.to).toContain('assignee@example.com');
    expect(callArgs.to).toContain('admin@example.com');
  });

  it('excludes comment author when author is the assignee (FR-11)', async () => {
    const data = { ...baseData, commentAuthorId: ASSIGNEE_ID };
    mockQuery.mockResolvedValueOnce(
      makeQueryRows([CREATOR_ID, ADMIN_ID], ['creator@example.com', 'admin@example.com']),
    );

    await sendCommentNotificationEmail(data);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMail.mock.calls[0][0] as { to: string };
    expect(callArgs.to).toContain('creator@example.com');
    expect(callArgs.to).toContain('admin@example.com');
  });

  it('excludes comment author when author is the admin (FR-11)', async () => {
    const data = { ...baseData, commentAuthorId: ADMIN_ID };
    mockQuery.mockResolvedValueOnce(
      makeQueryRows([CREATOR_ID, ASSIGNEE_ID], ['creator@example.com', 'assignee@example.com']),
    );

    await sendCommentNotificationEmail(data);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMail.mock.calls[0][0] as { to: string };
    expect(callArgs.to).toContain('creator@example.com');
    expect(callArgs.to).toContain('assignee@example.com');
  });

  it('sends to all three (creator + assignee + admin) when author is a different user (FR-11)', async () => {
    // AUTHOR_ID is distinct from CREATOR, ASSIGNEE, ADMIN
    mockQuery.mockResolvedValueOnce(
      makeQueryRows(
        [CREATOR_ID, ASSIGNEE_ID, ADMIN_ID],
        ['creator@example.com', 'assignee@example.com', 'admin@example.com'],
      ),
    );

    await sendCommentNotificationEmail(baseData);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMail.mock.calls[0][0] as { to: string };
    expect(callArgs.to).toContain('creator@example.com');
    expect(callArgs.to).toContain('assignee@example.com');
    expect(callArgs.to).toContain('admin@example.com');
  });

  it('does NOT call sendMail when all involved parties are the same person AND the author (FR-11)', async () => {
    // creator = assignee = admin = author → all filtered out before resolveEmails is called
    const data = {
      ...baseData,
      commentAuthorId: CREATOR_ID,
      assigneeId: CREATOR_ID,
      adminId: CREATOR_ID,
    };
    // No mockQuery setup needed: recipientIds is empty after filter, so resolveEmails
    // returns [] immediately without hitting the DB.

    await sendCommentNotificationEmail(data);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('includes attachment note in email text when attachmentCount > 0 (FR-11)', async () => {
    const data = {
      ...baseData,
      attachmentCount: 2,
      attachmentFilenames: ['a.png', 'b.jpg'],
    };
    mockQuery.mockResolvedValueOnce(
      makeQueryRows([CREATOR_ID, ADMIN_ID], ['creator@example.com', 'admin@example.com']),
    );

    await sendCommentNotificationEmail(data);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMail.mock.calls[0][0] as { text: string };
    expect(callArgs.text).toContain('Attachments');
    expect(callArgs.text).toContain('a.png');
    expect(callArgs.text).toContain('b.jpg');
  });

  it('omits attachment note when attachmentCount is undefined (FR-11)', async () => {
    // baseData has no attachmentCount
    mockQuery.mockResolvedValueOnce(
      makeQueryRows([CREATOR_ID, ADMIN_ID], ['creator@example.com', 'admin@example.com']),
    );

    await sendCommentNotificationEmail(baseData);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMail.mock.calls[0][0] as { text: string };
    expect(callArgs.text).not.toContain('Attachments');
  });

  it('resolves without re-throwing when sendMail throws (NFR-8 fire-and-forget)', async () => {
    mockQuery.mockResolvedValueOnce(
      makeQueryRows([CREATOR_ID, ADMIN_ID], ['creator@example.com', 'admin@example.com']),
    );
    mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));

    await expect(sendCommentNotificationEmail(baseData)).resolves.toBeUndefined();
  });

  it('resolves without re-throwing when query throws (NFR-8 fire-and-forget)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    await expect(sendCommentNotificationEmail(baseData)).resolves.toBeUndefined();
  });
});
