import { Router } from 'express';
import * as controller from './user.controller';

const router = Router();

router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.put('/:id', controller.updateOne);
router.delete('/:id', controller.removeOne);

export default router;
