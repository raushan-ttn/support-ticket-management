import { Router } from 'express';
import * as controller from './ticket.controller';

const router = Router();

router.get('/', controller.getAll);
router.post('/', controller.createOne);
router.get('/:id', controller.getOne);
router.put('/:id', controller.updateOne);
router.delete('/:id', controller.removeOne);

export default router;
