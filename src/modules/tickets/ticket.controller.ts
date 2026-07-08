import { NextFunction, Request, Response } from 'express';

import { error, success } from '../../utils/response';
import { uuidParam } from '../../utils/zodHelpers';
import { ListTicketsQuery, StatusTransitionPayload, TicketStatus } from './ticket.schemas';
import * as ticketService from './ticket.service';

function getUser(req: Request, res: Response): Express.User | null {
  if (!req.user) {
    error(res, 'Unauthorized', 401);
    return null;
  }
  return req.user;
}

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : undefined;
    const ticket = await ticketService.createTicket(req.body, user.id, files);
    success(res, ticket, 201);
  } catch (err) {
    next(err);
  }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const result = await ticketService.listTickets(
      user.id,
      user.role,
      req.query as unknown as ListTicketsQuery,
    );
    success(res, result);
  } catch (err) {
    next(err);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const id = uuidParam.parse(req.params.id);
    const ticket = await ticketService.getTicketById(id, user.id, user.role);
    success(res, ticket);
  } catch (err) {
    next(err);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const id = uuidParam.parse(req.params.id);
    const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : undefined;
    const ticket = await ticketService.updateTicket(id, req.body, user.id, user.role, files);
    success(res, ticket);
  } catch (err) {
    next(err);
  }
};

export const transitionStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const id = uuidParam.parse(req.params.id);
    const { status } = req.body as StatusTransitionPayload;
    const ticket = await ticketService.transitionStatus(
      id,
      status as TicketStatus,
      user.id,
      user.role,
    );
    success(res, ticket);
  } catch (err) {
    next(err);
  }
};

export const assign = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const id = uuidParam.parse(req.params.id);
    const ticket = await ticketService.assignTicket(id, req.body);
    success(res, ticket);
  } catch (err) {
    next(err);
  }
};
