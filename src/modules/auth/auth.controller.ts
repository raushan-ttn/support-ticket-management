import { NextFunction, Request, Response } from 'express';

import { success } from '../../utils/response';
import { AuthUser } from './auth.schemas';
import * as authService from './auth.service';

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await authService.signToken(req.user as AuthUser);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

export const getMe = (_req: Request, res: Response, _next: NextFunction): void => {
  success(res, _req.user as AuthUser);
};
