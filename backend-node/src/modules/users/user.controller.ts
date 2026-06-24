import { Request, Response, NextFunction } from 'express';
import * as userService from './user.service';
import { success, error } from '../../utils/response';

export const getAll = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await userService.findAll();
    success(res, data);
  } catch (err) {
    next(err);
  }
};

export const getOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await userService.findById(req.params.id);
    if (!data) {
      error(res, 'User not found', 404);
      return;
    }
    success(res, data);
  } catch (err) {
    next(err);
  }
};

export const updateOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await userService.update(req.params.id, req.body);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

export const removeOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await userService.remove(req.params.id);
    success(res, null, 204);
  } catch (err) {
    next(err);
  }
};
