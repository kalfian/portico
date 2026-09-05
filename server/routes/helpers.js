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

// Async variant: wrap an async handler so a rejected promise (or thrown error)
// flows to the error middleware instead of becoming an unhandled rejection.
function wrapAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { wrap, wrapAsync };
