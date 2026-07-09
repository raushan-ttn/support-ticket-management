import config from '../../config';
import { query } from '../../config/postgres';
import { deleteCache, getCache, setCache } from '../../config/redis';
import { buildStorageKey, getStorageBackend } from '../../storage';
import {
  getAttachmentsByComment,
  getAttachmentsByTicket,
  toAttachmentUrl,
  uploadAttachments,
} from './attachment.service';

jest.mock('../../config/postgres', () => ({ query: jest.fn() }));

jest.mock('../../config/redis', () => ({
  getCache: jest.fn(),
  setCache: jest.fn(),
  deleteCache: jest.fn(),
}));

jest.mock('../../storage', () => ({
  buildStorageKey: jest.fn(),
  getStorageBackend: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockGetCache = getCache as jest.MockedFunction<typeof getCache>;
const mockSetCache = setCache as jest.MockedFunction<typeof setCache>;
const mockDeleteCache = deleteCache as jest.MockedFunction<typeof deleteCache>;
const mockBuildStorageKey = buildStorageKey as jest.MockedFunction<typeof buildStorageKey>;
const mockGetStorageBackend = getStorageBackend as jest.MockedFunction<typeof getStorageBackend>;

const TICKET_ID = 'cccccccc-0000-0000-0000-000000000003';
const COMMENT_ID = 'dddddddd-0000-0000-0000-000000000004';
const UPLOADER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const STORAGE_KEY = '2026-07-08/eeeeeeee-0000-0000-0000-000000000005';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1234,
    buffer: Buffer.from('fake image bytes'),
    ...overrides,
  } as Express.Multer.File;
}

const mockSave = jest.fn();
const mockDelete = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildStorageKey.mockReturnValue(STORAGE_KEY);
  mockGetStorageBackend.mockResolvedValue({
    save: mockSave,
    delete: mockDelete,
    getStream: jest.fn(),
  });
  mockSave.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  mockDeleteCache.mockResolvedValue(undefined);
  mockGetCache.mockResolvedValue(null);
  mockSetCache.mockResolvedValue(undefined);
});

describe('toAttachmentUrl', () => {
  it('returns an absolute URL (APP_URL + key) for the local backend', () => {
    expect(toAttachmentUrl(STORAGE_KEY)).toBe(`${config.appUrl}/${STORAGE_KEY}`);
  });
});

describe('uploadAttachments', () => {
  it('returns an empty array when no files are provided', async () => {
    const result = await uploadAttachments(TICKET_ID, [], UPLOADER_ID);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME type with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const badFile = makeFile({ mimetype: 'application/pdf', originalname: 'doc.pdf' });

    await expect(uploadAttachments(TICKET_ID, [badFile], UPLOADER_ID)).rejects.toMatchObject({
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('rejects a commentId that does not belong to the ticket with 400 INVALID_COMMENT_REFERENCE', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(
      uploadAttachments(TICKET_ID, [makeFile()], UPLOADER_ID, COMMENT_ID),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_COMMENT_REFERENCE' });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('saves each file, inserts metadata, and returns AttachmentRow[] with url (no storageKey)', async () => {
    const insertedRow = {
      id: 'ffffffff-0000-0000-0000-000000000006',
      ticketId: TICKET_ID,
      commentId: null,
      filename: 'photo.png',
      storageKey: STORAGE_KEY,
      mimeType: 'image/png',
      sizeBytes: 1234,
      uploadedBy: UPLOADER_ID,
      createdAt: new Date().toISOString(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [insertedRow], rowCount: 1 } as never);

    const result = await uploadAttachments(TICKET_ID, [makeFile()], UPLOADER_ID);

    expect(mockSave).toHaveBeenCalledWith(STORAGE_KEY, expect.anything(), 'image/png', 1234);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('storageKey');
    expect(result[0].url).toBe(`${config.appUrl}/${STORAGE_KEY}`);
    expect(mockDeleteCache).toHaveBeenCalledWith(`ticket:${TICKET_ID}:attachments`);
  });

  it('validates commentId, then inserts the attachment row scoped to that comment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: COMMENT_ID }], rowCount: 1 } as never) // comment scope check
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ffffffff-0000-0000-0000-000000000006',
            ticketId: TICKET_ID,
            commentId: COMMENT_ID,
            filename: 'photo.png',
            storageKey: STORAGE_KEY,
            mimeType: 'image/png',
            sizeBytes: 1234,
            uploadedBy: UPLOADER_ID,
            createdAt: new Date().toISOString(),
          },
        ],
        rowCount: 1,
      } as never);

    const result = await uploadAttachments(TICKET_ID, [makeFile()], UPLOADER_ID, COMMENT_ID);

    expect(result[0].commentId).toBe(COMMENT_ID);
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1]).toEqual([
      TICKET_ID,
      COMMENT_ID,
      'photo.png',
      STORAGE_KEY,
      'image/png',
      1234,
      UPLOADER_ID,
    ]);
  });

  it('skips the file and inserts no metadata row when the storage backend save fails', async () => {
    mockSave.mockRejectedValueOnce(new Error('disk full'));

    const result = await uploadAttachments(TICKET_ID, [makeFile()], UPLOADER_ID);

    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('attempts to clean up the saved file when the metadata insert fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('constraint violation'));

    const result = await uploadAttachments(TICKET_ID, [makeFile()], UPLOADER_ID);

    expect(result).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(STORAGE_KEY);
  });
});

describe('getAttachmentsByTicket', () => {
  it('returns cached attachments without querying the DB on a cache hit', async () => {
    const cached = [
      {
        id: 'x',
        ticketId: TICKET_ID,
        commentId: null,
        filename: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        uploadedBy: UPLOADER_ID,
        createdAt: new Date().toISOString(),
        url: '/foo',
      },
    ];
    mockGetCache.mockResolvedValueOnce(cached);

    const result = await getAttachmentsByTicket(TICKET_ID);

    expect(result).toEqual(cached);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('queries the DB on a cache miss, strips storageKey, computes url, and writes the cache', async () => {
    mockGetCache.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'x',
          ticketId: TICKET_ID,
          commentId: null,
          filename: 'a.png',
          storageKey: STORAGE_KEY,
          mimeType: 'image/png',
          sizeBytes: 10,
          uploadedBy: UPLOADER_ID,
          createdAt: new Date().toISOString(),
        },
      ],
      rowCount: 1,
    } as never);

    const result = await getAttachmentsByTicket(TICKET_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('storageKey');
    expect(result[0].url).toBe(`${config.appUrl}/${STORAGE_KEY}`);
    expect(mockSetCache).toHaveBeenCalledWith(
      `ticket:${TICKET_ID}:attachments`,
      result,
      expect.any(Number),
    );
  });

  it('falls back to the DB when the cache read throws', async () => {
    mockGetCache.mockRejectedValueOnce(new Error('redis down'));
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const result = await getAttachmentsByTicket(TICKET_ID);

    expect(result).toEqual([]);
    expect(mockQuery).toHaveBeenCalled();
  });
});

describe('getAttachmentsByComment', () => {
  it('queries attachments scoped to the given commentId', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'x',
          ticketId: TICKET_ID,
          commentId: COMMENT_ID,
          filename: 'a.png',
          storageKey: STORAGE_KEY,
          mimeType: 'image/png',
          sizeBytes: 10,
          uploadedBy: UPLOADER_ID,
          createdAt: new Date().toISOString(),
        },
      ],
      rowCount: 1,
    } as never);

    const result = await getAttachmentsByComment(COMMENT_ID);

    expect(mockQuery.mock.calls[0][1]).toEqual([COMMENT_ID]);
    expect(result[0].commentId).toBe(COMMENT_ID);
    expect(result[0]).not.toHaveProperty('storageKey');
  });
});
