import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import config from '../config';
import { error } from '../utils/response';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
  /** Extra top-level response body fields (e.g. { from, to } for SM-2 transition errors). */
  extra?: Record<string, unknown>;
}

const errorHandler = (
  err: AppError | ZodError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File exceeds the maximum allowed size'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Too many files in a single request'
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Unexpected file field name'
            : err.message;
    error(res, message, 400, 'VALIDATION_ERROR');
    return;
  }

  if (err instanceof ZodError) {
    const message = err.issues
      .map(
        (e: { path: PropertyKey[]; message: string }) =>
          `${e.path.join('.') || 'body'}: ${e.message}`,
      )
      .join('; ');
    error(res, message, 400, 'VALIDATION_ERROR');
    return;
  }

  const statusCode = (err as AppError).statusCode ?? 500;
  const message =
    statusCode < 500
      ? err.message
      : config.env === 'production'
        ? 'Internal Server Error'
        : err.message;

  const code = (err as AppError).code;
  const rawExtra = (err as AppError).extra;
  const RESERVED_KEYS = new Set(['success', 'message', 'code', 'stack']);
  const extra =
    rawExtra !== undefined
      ? Object.fromEntries(Object.entries(rawExtra).filter(([key]) => !RESERVED_KEYS.has(key)))
      : undefined;
  res.status(statusCode).json({
    success: false,
    message,
    ...(code !== undefined && { code }),
    ...(extra !== undefined && extra),
    ...(config.env === 'development' && { stack: err.stack }),
  });
};

export default errorHandler;
