import multer from 'multer';
import config from '../config';
import { ALLOWED_ATTACHMENT_MIMES } from '../modules/attachments/attachment.schemas';

const uploadAttachments = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.attachment.maxFileSizeBytes,
    files: config.attachment.maxFilesPerRequest,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIMES.has(file.mimetype)) {
      return cb(
        Object.assign(
          new Error(`File type '${file.mimetype}' is not allowed. Only image/jpeg and image/png are accepted.`),
          { statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
        ),
      );
    }
    cb(null, true);
  },
});

// Pre-bound to the 'files' field so route files don't need to import config to pass maxCount
export const uploadAttachmentFiles = uploadAttachments.array('files', config.attachment.maxFilesPerRequest);
