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
  const cloudflareRoutes = store.listCloudflareRoutes();

  const edges = [];
  for (const n of nodes) {
    if (n.parentId) {
      const parent = nodes.find((candidate) => candidate.id === n.parentId);
      const virtualization = parent && parent.type === 'proxmox_host' && (n.type === 'vm' || n.type === 'lxc');
      edges.push({ id: `edge-${n.parentId}-${n.id}`, from: n.parentId, to: n.id, kind: virtualization ? 'virtualization' : 'containment', type: virtualization ? 'virtualization' : 'containment' });
    }
  }
  for (const l of links) {
    edges.push({ id: l.id, from: l.fromNodeId, to: l.toNodeId, kind: l.type, type: l.type, label: l.label });
  }
  for (const p of ports) {
    edges.push({ id: `edge-port-${p.id}`, from: p.nodeId, to: p.id, kind: 'port_ownership', type: 'port_ownership', label: `${p.protocol}/${p.portNumber}` });
  }

  res.json({ contract: 'portico.topology.v1', nodes, ports, networks, links, cloudflareRoutes, edges });
}));

// Full export — same shape as the prototype's JSON export (camelCase).
router.get('/export', wrap((req, res) => res.json(store.exportAll())));
router.get('/cloudflare-routes', wrap((req, res) => res.json(store.listCloudflareRoutes())));

// Replace-all import (transactional). Auth required.
router.post('/import', requireWrite, wrap((req, res) => res.json(store.importAll(req.body || {}))));

// --- LLM-friendly endpoints ---
// One-call, digestible view of the whole homelab (markdown summary + raw data).
router.get('/llm/context', wrap((req, res) => res.json(buildLlmContext())));

// Machine-discoverable API description.
router.get('/openapi.json', wrap((req, res) => res.json(spec)));

module.exports = router;
