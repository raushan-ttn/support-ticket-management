import { NextFunction, Request, Response } from 'express';

import passport from '../config/passport';
import { error } from '../utils/response';

const authenticate = (req: Request, res: Response, next: NextFunction): void => {
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

export default authenticate;
