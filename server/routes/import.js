'use strict';

// Import from real sources: parse (dry-run preview) → apply (additive, transactional).
// Both require auth. Note: the legacy replace-all `POST /api/import` lives in
// routes/data.js; these are the source-parsing additive importers.

const express = require('express');
const store = require('../store');
const { requireWrite } = require('../auth');
const { parseSource } = require('../lib/importers');
const { wrap } = require('./helpers');

const router = express.Router();

// Dry-run: parse raw command output into a preview. NO DB writes.
router.post('/import/parse', requireWrite, wrap((req, res) => {
  const body = req.body || {};
  res.json(parseSource(body.source, body.text));
}));

// Apply a (possibly user-edited) preview payload additively, de-duping.
router.post('/import/apply', requireWrite, wrap((req, res) => {
  res.json(store.importParsed(req.body || {}));
}));

module.exports = router;
