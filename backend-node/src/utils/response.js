'use strict';

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const error = (res, message, statusCode = 500) =>
  res.status(statusCode).json({ success: false, message });

module.exports = { success, error };
