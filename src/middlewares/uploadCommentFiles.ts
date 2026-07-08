import multer from 'multer';
import config from '../config';
import { ALLOWED_ATTACHMENT_MIMES } from '../modules/attachments/attachment.schemas';

// Screenshot keeps the broad, config-driven allowlist it always had.
const SCREENSHOT_ALLOWED_MIMES = new Set(config.attachment.allowedMimeTypes);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.attachment.maxFileSizeBytes,
    files: config.attachment.maxFilesPerRequest + 1, // +1 for the optional single screenshot field
  },
  fileFilter: (_req, file, cb) => {
    const allowed = file.fieldname === 'screenshot' ? SCREENSHOT_ALLOWED_MIMES : ALLOWED_ATTACHMENT_MIMES;
    if (!allowed.has(file.mimetype)) {
      return cb(
        Object.assign(new Error(`File type '${file.mimetype}' is not allowed`), {
          statusCode: 415,
          code: 'UNSUPPORTED_MEDIA_TYPE',
        }),
      );
    }
    cb(null, true);
  },
});

// A single multer pass parsing both the 'screenshot' and 'files' fields — two separate
// multer instances cannot be chained on one multipart request (the first fully consumes
// the request stream, and .single() rejects any other file field as unexpected).
export const uploadCommentFiles = upload.fields([
  { name: 'screenshot', maxCount: 1 },
  { name: 'files', maxCount: config.attachment.maxFilesPerRequest },
]);
