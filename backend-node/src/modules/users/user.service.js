'use strict';

const findAll = async () => {
  // TODO: query DB
  return [];
};

const findById = async (id) => {
  // TODO: query DB by id
  return { id, name: 'John Doe', email: 'john@example.com', role: 'user' };
};

const update = async (id, payload) => {
  // TODO: update record in DB
  return { id, ...payload };
};

const remove = async (id) => {
  // TODO: delete record from DB
  return { id };
};

module.exports = { findAll, findById, update, remove };
