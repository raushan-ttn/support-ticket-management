import { NextFunction, Request, Response } from 'express';

import { error, success } from '../../utils/response';
import { uuidParam } from '../../utils/zodHelpers';
import * as commentService from './comment.service';
import type { CreateCommentPayload } from './comment.schemas';

function getUser(req: Request, res: Response): Express.User | null {
  if (!req.user) {
    error(res, 'Unauthorized', 401);
    return null;
  }
  return req.user;
}

export const add = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const ticketId = uuidParam.parse(req.params.ticketId);
    const comment = await commentService.addComment(
      ticketId,
      (req.body as CreateCommentPayload).message,
      req.file,
      user.id,
      user.role,
    );
    success(res, comment, 201);
  } catch (err) {
    next(err);
  }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const ticketId = uuidParam.parse(req.params.ticketId);
    const comments = await commentService.listComments(ticketId, user.id, user.role);
    success(res, comments);
  } catch (err) {
    next(err);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const ticketId = uuidParam.parse(req.params.ticketId);
    const commentId = uuidParam.parse(req.params.commentId);
    const comment = await commentService.getCommentById(ticketId, commentId, user.id, user.role);
    success(res, comment);
  } catch (err) {
    next(err);
  }
};
