'use strict';

const userService = require('./user.service');
const { success, error } = require('../../utils/response');

const getAll = async (req, res, next) => {
  try {
    const data = await userService.findAll();
    success(res, data);
  } catch (err) {
    next(err);
  }
};

const getOne = async (req, res, next) => {
  try {
    const data = await userService.findById(req.params.id);
    if (!data) return error(res, 'User not found', 404);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

const updateOne = async (req, res, next) => {
  try {
    const data = await userService.update(req.params.id, req.body);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

const removeOne = async (req, res, next) => {
  try {
    await userService.remove(req.params.id);
    success(res, null, 204);
  } catch (err) {
    next(err);
  }
};

module.exports = { getAll, getOne, updateOne, removeOne };
