'use strict';

// Active health check. Mutations (write last_seen + node status) → require auth.

const express = require('express');
const { requireWrite } = require('../auth');
const { runProbe } = require('../lib/probe');
const { wrapAsync } = require('./helpers');

const router = express.Router();

// Probe everything, or a subset via { nodeIds: [...] }. Optional { timeout, concurrency }.
router.post('/probe', requireWrite, wrapAsync(async (req, res) => {
  const body = req.body || {};
  const summary = await runProbe({
    nodeIds: body.nodeIds,
    timeout: body.timeout,
    concurrency: body.concurrency,
  });
  res.json(summary);
}));

// Probe a single node + its ports.
router.post('/nodes/:id/probe', requireWrite, wrapAsync(async (req, res) => {
  const body = req.body || {};
  const summary = await runProbe({
    nodeIds: [req.params.id],
    timeout: body.timeout,
    concurrency: body.concurrency,
    single: true,
  });
  res.json(summary);
}));

module.exports = router;
