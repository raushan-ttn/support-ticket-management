import { Request, Response, NextFunction } from 'express';
import * as ticketService from './ticket.service';
import { success, error } from '../../utils/response';

export const getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await ticketService.findAll(req.query);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

export const getOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await ticketService.findById(req.params.id);
    if (!data) {
      error(res, 'Ticket not found', 404);
      return;
    }
    success(res, data);
  } catch (err) {
    next(err);
  }
};

export const createOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await ticketService.create(req.body);
    success(res, data, 201);
  } catch (err) {
    next(err);
  }
};

export const updateOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await ticketService.update(req.params.id, req.body);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

export const removeOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await ticketService.remove(req.params.id);
    success(res, null, 204);
  } catch (err) {
    next(err);
  }
};
