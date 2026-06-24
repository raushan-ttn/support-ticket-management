'use strict';

const { Router } = require('express');
const controller = require('./user.controller');

const router = Router();

router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.put('/:id', controller.updateOne);
router.delete('/:id', controller.removeOne);

module.exports = router;
