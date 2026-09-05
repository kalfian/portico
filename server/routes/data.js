'use strict';

// Topology (graph-shaped read) + export/import (JSON migration contract).

const express = require('express');
const store = require('../store');
const { requireWrite } = require('../auth');
const { buildLlmContext } = require('../lib/llm');
const { spec } = require('../lib/openapi');
const { wrap } = require('./helpers');

const router = express.Router();

// Graph-shaped payload for the topology view: nodes (with tags[]), ports, networks,
// and edges = containment (parent→child) merged with typed links.
router.get('/topology', wrap((req, res) => {
  const nodes = store.listNodes();
  const ports = store.getTopology().ports;
  const networks = store.listNetworks();
  const links = store.listLinks();

  const edges = [];
  for (const n of nodes) {
    if (n.parentId) edges.push({ id: `edge-${n.parentId}-${n.id}`, from: n.parentId, to: n.id, kind: 'containment' });
  }
  for (const l of links) {
    edges.push({ id: l.id, from: l.fromNodeId, to: l.toNodeId, kind: 'link', type: l.type, label: l.label });
  }

  res.json({ nodes, ports, networks, links, edges });
}));

// Full export — same shape as the prototype's JSON export (camelCase).
router.get('/export', wrap((req, res) => res.json(store.exportAll())));

// Replace-all import (transactional). Auth required.
router.post('/import', requireWrite, wrap((req, res) => res.json(store.importAll(req.body || {}))));

// --- LLM-friendly endpoints ---
// One-call, digestible view of the whole homelab (markdown summary + raw data).
router.get('/llm/context', wrap((req, res) => res.json(buildLlmContext())));

// Machine-discoverable API description.
router.get('/openapi.json', wrap((req, res) => res.json(spec)));

module.exports = router;
