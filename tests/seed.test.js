'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portico-seed-'));
process.env.DB_PATH = path.join(dir, 'seed.db');

const { NODE_TYPES } = require('../server/lib/enums');
const { buildSeed, seedIfEmpty } = require('../server/seed');
const store = require('../server/store');
const { db } = require('../server/db');
const dataRouter = require('../server/routes/data');

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function readRoute(pathname) {
  const layer = dataRouter.stack.find((candidate) => candidate.route && candidate.route.path === pathname);
  assert.ok(layer, `route ${pathname} must exist`);
  let payload;
  let failure;
  layer.route.stack[0].handle({}, { json(value) { payload = value; } }, (err) => { failure = err; });
  if (failure) throw failure;
  return payload;
}

test('demo seed is complete, internally consistent, and clearly non-live', () => {
  const seed = buildSeed();
  const nodeIds = new Set(seed.nodes.map((node) => node.id));
  const networkIds = new Set(seed.networks.map((network) => network.id));
  const routeIds = new Set(seed.cloudflareRoutes.map((route) => route.id));
  const allIds = [...seed.nodes, ...seed.networks, ...seed.links, ...seed.ports, ...seed.cloudflareRoutes]
    .map((entity) => entity.id);

  assert.deepEqual([...new Set(seed.nodes.map((node) => node.type))].sort(), [...NODE_TYPES].sort());
  unique(allIds, 'entity IDs');
  unique(seed.nodes.map((node) => node.id), 'node IDs');
  unique(seed.nodes.map((node) => node.externalId), 'node external refs');
  unique(seed.networks.map((network) => network.id), 'network IDs');
  unique(seed.links.map((link) => link.id), 'link IDs');
  unique(seed.ports.map((port) => port.id), 'port IDs');
  unique(seed.cloudflareRoutes.map((route) => route.id), 'route IDs');
  unique(seed.ports.map((port) => `${port.nodeId}:${port.portNumber}:${port.protocol}`), 'node/port/protocol tuples');

  for (const node of seed.nodes) {
    if (node.parentId) assert.ok(nodeIds.has(node.parentId), `missing parent ${node.parentId}`);
    assert.ok(networkIds.has(node.networkId), `missing network ${node.networkId}`);
  }
  for (const link of seed.links) {
    assert.ok(nodeIds.has(link.fromNodeId), `missing link source ${link.fromNodeId}`);
    assert.ok(nodeIds.has(link.toNodeId), `missing link target ${link.toNodeId}`);
  }
  for (const port of seed.ports) {
    assert.ok(nodeIds.has(port.nodeId), `missing port owner ${port.nodeId}`);
    if (port.targetNodeId) assert.ok(nodeIds.has(port.targetNodeId), `missing port target ${port.targetNodeId}`);
    if (port.cloudflareRouteId) assert.ok(routeIds.has(port.cloudflareRouteId), `missing route ${port.cloudflareRouteId}`);
  }

  for (const route of seed.cloudflareRoutes) {
    const linked = seed.ports.filter((port) => port.cloudflareRouteId === route.id);
    assert.ok(linked.length > 0, `route ${route.id} is not linked to a port`);
    assert.ok(linked.some((port) => {
      const owner = seed.nodes.find((node) => node.id === port.nodeId);
      return owner.ipAddress === route.targetHost && port.portNumber === route.targetPort && port.domain === route.hostname;
    }), `route ${route.id} does not match its linked owner and port`);
  }

  assert.deepEqual([...new Set(seed.ports.map((port) => port.exposure))].sort(), ['internal', 'lan', 'public']);
  assert.ok(seed.ports.some((port) => port.status === 'reserved'));
  assert.ok(seed.ports.some((port) => port.status === 'down'));
  assert.ok(seed.ports.some((port) => port.hostPort));
  assert.ok(seed.ports.some((port) => port.targetNodeId && port.cloudflareRouteId));

  const serialized = JSON.stringify(seed).toLowerCase();
  assert.doesNotMatch(serialized, /10\.20\.30\.|kalfian\.com|\bcanonical\b|\bverified\b/);
  for (const node of seed.nodes) assert.match(node.ipAddress, /^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
  for (const route of seed.cloudflareRoutes) assert.match(route.hostname, /\.example$/);
});

test('seed imports inventory projections once and leaves a nonempty database unchanged', () => {
  assert.equal(seedIfEmpty(), true);

  const exported = store.exportAll();
  const inventory = store.listInventory();
  const routed = inventory.find((item) => item.port.cloudflareRouteId === 'cf-demo-portal');
  assert.ok(routed);
  assert.equal(routed.owner.id, 'n-demo-proxy-lxc');
  assert.equal(routed.server.id, 'n-demo-proxmox');
  assert.equal(routed.target.id, 'n-demo-web-container');
  assert.equal(routed.cloudflareRoute.hostname, 'portal.portico-demo.example');

  assert.equal(seedIfEmpty(), false);
  assert.deepEqual(store.exportAll(), exported);
});

test('topology, inventory, and context routes project the seed for operator and MCP workflows', () => {
  const topology = readRoute('/topology');
  const inventory = readRoute('/inventory');
  const context = readRoute('/llm/context');

  assert.deepEqual([...new Set(topology.nodes.map((node) => node.type))].sort(), [...NODE_TYPES].sort());
  assert.ok(topology.edges.some((edge) => edge.kind === 'virtualization'));
  assert.ok(topology.edges.some((edge) => edge.kind === 'containment'));
  assert.ok(topology.edges.some((edge) => edge.kind === 'proxy'));
  assert.ok(topology.edges.some((edge) => edge.kind === 'port_ownership'));
  assert.equal(inventory.find((item) => item.port.id === 'p-demo-proxy-443-tcp').target.id, 'n-demo-web-container');
  assert.match(context.summary, /portal\.portico-demo\.example/);
  assert.equal(context.data.nodes.length, topology.nodes.length);
});
