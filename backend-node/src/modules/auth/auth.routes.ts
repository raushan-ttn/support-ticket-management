import { Router } from 'express';

import authenticate from '../../middlewares/authenticate';
import { validateBody } from '../../middlewares/validateBody';
import * as controller from './auth.controller';
import { authenticateLocal } from './auth.middleware';
import { loginSchema } from './auth.schemas';

const router = Router();

router.post('/login', validateBody(loginSchema), authenticateLocal, controller.login);
router.get('/me', authenticate, controller.getMe);

export default router;
