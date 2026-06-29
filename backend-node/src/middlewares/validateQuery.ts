import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

import { error } from '../utils/response';

export const validateQuery =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.') || 'query'}: ${i.message}`)
        .join('; ');
      error(res, message, 400, 'VALIDATION_ERROR');
      return;
    }
    req.query = result.data as unknown as typeof req.query;
    next();
  };
