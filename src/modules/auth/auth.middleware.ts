import { NextFunction, Request, Response } from 'express';

import passport from '../../config/passport';
import { error } from '../../utils/response';

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
