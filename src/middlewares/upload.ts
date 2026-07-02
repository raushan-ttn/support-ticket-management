import multer from 'multer';
import config from '../config';

const allowedMimes = new Set(config.attachment.allowedMimeTypes);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.attachment.maxFileSizeBytes,
    files: config.attachment.maxFilesPerRequest,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimes.has(file.mimetype)) {
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
