'use strict';

const express = require('express');
const store = require('../store');
const { requireWrite } = require('../auth');
const { wrap } = require('./helpers');

const router = express.Router();

// --- nodes ---
router.get('/nodes', wrap((req, res) => res.json(store.listNodes())));
router.get('/nodes/:id', wrap((req, res) => res.json(store.getNode(req.params.id))));
router.post('/nodes', requireWrite, wrap((req, res) => res.status(201).json(store.createNode(req.body || {}))));
router.put('/nodes/:id', requireWrite, wrap((req, res) => res.json(store.updateNode(req.params.id, req.body || {}))));
router.delete('/nodes/:id', requireWrite, wrap((req, res) => res.json(store.deleteNode(req.params.id))));

// --- ports nested under a node ---
router.get('/nodes/:id/ports', wrap((req, res) => res.json(store.listPortsForNode(req.params.id))));
router.post('/nodes/:id/ports', requireWrite, wrap((req, res) => res.status(201).json(store.createPort(req.params.id, req.body || {}))));

// --- free-port finder ---
router.get('/nodes/:id/free-ports', wrap((req, res) => {
  res.json(store.freePorts(req.params.id, { from: req.query.from, to: req.query.to, protocol: req.query.protocol }));
}));

module.exports = router;
