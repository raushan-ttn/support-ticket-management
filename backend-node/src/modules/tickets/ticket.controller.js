'use strict';

const ticketService = require('./ticket.service');
const { success, error } = require('../../utils/response');

const getAll = async (req, res, next) => {
  try {
    const data = await ticketService.findAll(req.query);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

const getOne = async (req, res, next) => {
  try {
    const data = await ticketService.findById(req.params.id);
    if (!data) return error(res, 'Ticket not found', 404);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

const createOne = async (req, res, next) => {
  try {
    const data = await ticketService.create(req.body);
    success(res, data, 201);
  } catch (err) {
    next(err);
  }
};

const updateOne = async (req, res, next) => {
  try {
    const data = await ticketService.update(req.params.id, req.body);
    success(res, data);
  } catch (err) {
    next(err);
  }
};

const removeOne = async (req, res, next) => {
  try {
    await ticketService.remove(req.params.id);
    success(res, null, 204);
  } catch (err) {
    next(err);
  }
};

module.exports = { getAll, getOne, createOne, updateOne, removeOne };
