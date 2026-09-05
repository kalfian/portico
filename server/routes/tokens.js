'use strict';

// API token management. All endpoints require an interactive SESSION — a bearer
// token cannot mint or revoke other tokens.

const express = require('express');
const tokens = require('../tokens');
const { requireSession } = require('../auth');
const { wrap } = require('./helpers');

const router = express.Router();

// List token metadata only — plaintext is never retrievable after creation.
router.get('/tokens', requireSession, wrap((req, res) => res.json(tokens.listTokens())));

// Create → returns the plaintext token ONCE.
router.post('/tokens', requireSession, wrap((req, res) => {
  const { name, scope } = req.body || {};
  res.status(201).json(tokens.createToken(name, scope));
}));

// Revoke.
router.delete('/tokens/:id', requireSession, wrap((req, res) => res.json(tokens.revokeToken(req.params.id))));

module.exports = router;
