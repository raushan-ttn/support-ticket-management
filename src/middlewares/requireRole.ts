import { NextFunction, Request, Response } from 'express';

import { error } from '../utils/response';

type Role = Express.User['role'];

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user || !roles.includes(user.role)) {
      error(res, 'Forbidden', 403);
      return;
    }
    next();
  };
