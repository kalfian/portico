'use strict';

const express = require('express');
const store = require('../store');
const { requireWrite } = require('../auth');
const { wrap } = require('./helpers');

const router = express.Router();

router.get('/links', wrap((req, res) => res.json(store.listLinks())));
router.post('/links', requireWrite, wrap((req, res) => res.status(201).json(store.createLink(req.body || {}))));
router.put('/links/:id', requireWrite, wrap((req, res) => res.json(store.updateLink(req.params.id, req.body || {}))));
router.delete('/links/:id', requireWrite, wrap((req, res) => res.json(store.deleteLink(req.params.id))));

module.exports = router;
