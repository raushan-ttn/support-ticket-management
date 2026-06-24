'use strict';

const register = async (payload) => {
  // TODO: hash password, save user to DB, return created user
  return { id: 1, email: payload.email, role: 'user' };
};

const login = async (payload) => {
  // TODO: validate credentials, sign and return JWT
  return { token: 'sample.jwt.token', email: payload.email };
};

module.exports = { register, login };
