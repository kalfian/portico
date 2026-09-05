'use strict';

const express = require('express');
const auth = require('../auth');
const { ApiError } = require('../lib/util');
const { wrap } = require('./helpers');

const router = express.Router();

// Current auth state — safe to call anonymously.
router.get('/auth/status', wrap((req, res) => {
  res.json({
    isSetup: auth.isSetup(),
    isAuthenticated: !!(req.session && req.session.authenticated),
    authMethod: (req.auth && req.auth.method) || null,
    scope: (req.auth && req.auth.scope) || null,
  });
}));

// First-run: create the initial password. Only allowed when none is set.
router.post('/auth/setup', wrap((req, res) => {
  auth.setup((req.body || {}).password);
  req.session.authenticated = true; // log in immediately after setup
  res.status(201).json({ isSetup: true, isAuthenticated: true });
}));

router.post('/auth/login', wrap((req, res) => {
  const { password } = req.body || {};
  if (!auth.isSetup()) throw new ApiError(400, 'No password set — run setup first', 'validation_error');
  if (!auth.verify(password)) throw new ApiError(401, 'Invalid password', 'unauthorized');
  req.session.authenticated = true;
  res.json({ isAuthenticated: true });
}));

router.post('/auth/logout', wrap((req, res) => {
  if (req.session) req.session.destroy(() => res.json({ isAuthenticated: false }));
  else res.json({ isAuthenticated: false });
}));

// Change password requires an interactive session (not a bearer token).
router.post('/auth/change-password', auth.requireSession, wrap((req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  auth.changePassword(currentPassword, newPassword);
  res.json({ ok: true });
}));

module.exports = router;
