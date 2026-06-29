import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

import { error } from '../utils/response';

export const validateBody =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      error(res, message, 400, 'VALIDATION_ERROR');
      return;
    }
    req.body = result.data;
    next();
  };
