import { Router } from 'express';

import * as controller from './auth.controller';
import { authenticateJwt, authenticateLocal, validateLogin } from './auth.middleware';

const router = Router();

router.post('/login', validateLogin, authenticateLocal, controller.login);
router.get('/me', authenticateJwt, controller.getMe);

export default router;
