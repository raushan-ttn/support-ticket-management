import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import config from '../config';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

const errorHandler = (
  err: AppError | ZodError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ZodError) {
    const message = err.issues
      .map(
        (e: { path: PropertyKey[]; message: string }) =>
          `${e.path.join('.') || 'body'}: ${e.message}`,
      )
      .join('; ');
    res.status(400).json({ success: false, message });
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
  res.status(statusCode).json({
    success: false,
    message,
    ...(code !== undefined && { code }),
    ...(config.env === 'development' && { stack: err.stack }),
  });
};

export default errorHandler;
