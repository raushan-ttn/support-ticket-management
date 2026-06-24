import { Response } from 'express';

export const success = (res: Response, data: unknown, statusCode = 200): Response =>
  res.status(statusCode).json({ success: true, data });

export const error = (res: Response, message: string, statusCode = 500): Response =>
  res.status(statusCode).json({ success: false, message });
