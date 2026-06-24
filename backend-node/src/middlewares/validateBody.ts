import { ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { error } from '../utils/response';

export const validateBody =
  <T>(schema: ZodSchema<T>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map(
          (e: { path: PropertyKey[]; message: string }) =>
            `${e.path.join('.') || 'body'}: ${e.message}`,
        )
        .join('; ');
      error(res, message, 400);
      return;
    }
    req.body = result.data;
    next();
  };
