'use strict';

const express = require('express');
const store = require('../store');
const { requireWrite } = require('../auth');
const { wrap } = require('./helpers');

const router = express.Router();

router.put('/ports/:id', requireWrite, wrap((req, res) => res.json(store.updatePort(req.params.id, req.body || {}))));
router.delete('/ports/:id', requireWrite, wrap((req, res) => res.json(store.deletePort(req.params.id))));

module.exports = router;
