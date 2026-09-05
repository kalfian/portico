'use strict';

// Wrap a synchronous handler so thrown ApiError (or any error) flows to the
// error middleware instead of crashing the request.
function wrap(fn) {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { wrap };
