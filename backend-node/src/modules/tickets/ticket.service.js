'use strict';

const findAll = async (filters = {}) => {
  // TODO: query DB with filters (status, priority, assignee)
  return [];
};

const findById = async (id) => {
  // TODO: query DB by id
  return { id, title: 'Sample ticket', status: 'open', priority: 'medium' };
};

const create = async (payload) => {
  // TODO: insert record into DB
  return { id: Date.now(), ...payload, status: 'open' };
};

const update = async (id, payload) => {
  // TODO: update record in DB
  return { id, ...payload };
};

const remove = async (id) => {
  // TODO: delete record from DB
  return { id };
};

module.exports = { findAll, findById, create, update, remove };
