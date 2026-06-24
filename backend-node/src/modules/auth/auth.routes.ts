import { Router, Request, Response, NextFunction } from 'express';
import passport from '../../config/passport';
import { validateBody } from '../../middlewares/validateBody';
import { registerSchema, loginSchema } from './auth.schemas';
import { error } from '../../utils/response';
import * as controller from './auth.controller';

const router = Router();

router.post('/register', validateBody(registerSchema), controller.register);

router.post(
  '/login',
  validateBody(loginSchema),
  (req: Request, res: Response, next: NextFunction) => {
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
  },
  controller.login,
);

export default router;
