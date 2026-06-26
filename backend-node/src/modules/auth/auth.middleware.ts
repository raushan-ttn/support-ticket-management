import { Request, Response, NextFunction } from 'express';

import passport from '../../config/passport';
import { error } from '../../utils/response';
import { loginSchema } from './auth.schemas';

export const validateLogin = (req: Request, res: Response, next: NextFunction): void => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    const message = result.error.issues
      .map((e) => `${e.path.join('.') || 'body'}: ${e.message}`)
      .join('; ');
    error(res, message, 400);
    return;
  }
  req.body = result.data;
  next();
};

export const authenticateLocal = (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate(
    'local',
    { session: false },
    (err: Error | null, user: Express.User | false, info?: { message: string }) => {
      if (err) return next(err);
      if (!user) {
        error(res, info?.message ?? 'Invalid credentials', 401);
        return;
      }
      req.user = user;
      next();
    },
  )(req, res, next);
};

export const authenticateJwt = (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate(
    'jwt',
    { session: false },
    (err: Error | null, user: Express.User | false) => {
      if (err) return next(err);
      if (!user) {
        error(res, 'Unauthorized', 401);
        return;
      }
      req.user = user;
      next();
    },
  )(req, res, next);
};
