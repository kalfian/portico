'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portico-inventory-'));
process.env.DB_PATH = path.join(dir, 'inventory.db');
const store = require('../server/store');
const { db } = require('../server/db');

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inventory projects server, app owner, target and explicit Cloudflare route', () => {
  store.importAll({
    nodes: [
      { id: 'server', name: 'Server', type: 'docker_host', ipAddress: '10.0.0.10' },
      { id: 'app', name: 'Photos', type: 'container', parentId: 'server', ipAddress: '172.18.0.2' },
      { id: 'target', name: 'Storage', type: 'container', parentId: 'server', ipAddress: '172.18.0.3' },
    ],
    ports: [{
      id: 'port', nodeId: 'app', portNumber: 2283, protocol: 'tcp', serviceName: 'immich',
      exposureMode: 'cloudflare', domain: 'stale.example.com', cloudflareRouteId: 'route', targetNodeId: 'target',
    }],
    cloudflareRoutes: [{
      id: 'route', hostname: 'photos.example.com', target: 'http://10.0.0.10:2283',
      targetHost: '10.0.0.10', targetPort: 2283, exposure: 'public',
    }],
  });

  const updated = store.updatePort('port', { cloudflareRouteId: 'route', domain: 'wrong.example.com' });
  assert.equal(updated.domain, 'photos.example.com');
  const [item] = store.listInventory();
  assert.equal(item.owner.id, 'app');
  assert.equal(item.server.id, 'server');
  assert.equal(item.target.id, 'target');
  assert.equal(item.cloudflareRoute.hostname, 'photos.example.com');
  assert.throws(() => store.updatePort('port', { cloudflareRouteId: 'missing' }), /Cloudflare route not found/);

  const lan = store.updatePort('port', { exposureMode: 'lan' });
  assert.equal(lan.cloudflareRouteId, null);
  assert.equal(lan.domain, '');
});
