'use strict';

const express = require('express');
const store = require('../store');
const { authenticate } = require('../auth');

const router = express.Router();

const tools = [
  { name: 'topology_get', description: 'Read the complete home-server topology, including nodes, ports, containment, networks, and links.', inputSchema: { type: 'object', properties: {} } },
  { name: 'node_create', description: 'Create a topology node. parentIds supports zero or more parents.', inputSchema: { type: 'object', properties: { node: { type: 'object' } }, required: ['node'] } },
  { name: 'node_update', description: 'Update a topology node, including parentIds and graph position.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, node: { type: 'object' } }, required: ['id', 'node'] } },
  { name: 'node_delete', description: 'Delete a topology node and its containment edges.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'port_create', description: 'Create a port for a node. Use externalUrl for the URL users should open.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, port: { type: 'object' } }, required: ['nodeId', 'port'] } },
  { name: 'port_update', description: 'Update a port, including externalUrl and graph position.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, port: { type: 'object' } }, required: ['id', 'port'] } },
  { name: 'port_delete', description: 'Delete a port.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

function response(res, id, result) {
  res.json({ jsonrpc: '2.0', id, result });
}

function error(res, id, code, message) {
  res.status(code === -32600 ? 400 : 200).json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

function requireMcpAuth(req, res, id, write) {
  if (!req.auth?.scope) {
    error(res, id, -32001, 'Authentication required');
    return false;
  }
  if (write && req.auth.scope !== 'read_write') {
    error(res, id, -32003, 'This token is read-only');
    return false;
  }
  return true;
}

router.post('/', authenticate, (req, res) => {
  const { id, method, params = {} } = req.body || {};
  if (!method) return error(res, id, -32600, 'Invalid JSON-RPC request');
  if (method === 'notifications/initialized') return res.status(202).end();
  if (method === 'initialize') {
    return response(res, id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'portico', version: '1.0.0' },
    });
  }
  if (!requireMcpAuth(req, res, id, false)) return;
  if (method === 'tools/list') return response(res, id, { tools });
  if (method !== 'tools/call') return error(res, id, -32601, `Method not found: ${method}`);

  const name = params.name;
  const args = params.arguments || {};
  const writes = new Set(['node_create', 'node_update', 'node_delete', 'port_create', 'port_update', 'port_delete']);
  if (!tools.some((tool) => tool.name === name)) return error(res, id, -32602, `Unknown tool: ${name}`);
  if (!requireMcpAuth(req, res, id, writes.has(name))) return;
  try {
    let data;
    if (name === 'topology_get') data = store.getTopology();
    if (name === 'node_create') data = store.createNode(args.node || {});
    if (name === 'node_update') data = store.updateNode(args.id, args.node || {});
    if (name === 'node_delete') data = store.deleteNode(args.id);
    if (name === 'port_create') data = store.createPort(args.nodeId, args.port || {});
    if (name === 'port_update') data = store.updatePort(args.id, args.port || {});
    if (name === 'port_delete') data = store.deletePort(args.id);
    return response(res, id, toolResult(data));
  } catch (err) {
    return error(res, id, -32000, err.message || 'Tool call failed');
  }
});

module.exports = router;
