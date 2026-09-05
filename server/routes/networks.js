'use strict';

const express = require('express');
const store = require('../store');
const { requireWrite } = require('../auth');
const { wrap } = require('./helpers');

const router = express.Router();

router.get('/networks', wrap((req, res) => res.json(store.listNetworks())));
router.post('/networks', requireWrite, wrap((req, res) => res.status(201).json(store.createNetwork(req.body || {}))));
router.put('/networks/:id', requireWrite, wrap((req, res) => res.json(store.updateNetwork(req.params.id, req.body || {}))));
router.delete('/networks/:id', requireWrite, wrap((req, res) => res.json(store.deleteNetwork(req.params.id))));
router.get('/networks/:id/free-ips', wrap((req, res) => res.json(store.freeIps(req.params.id, { limit: req.query.limit }))));

module.exports = router;
