'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portico-test-'));
process.env.DB_PATH = path.join(dir, 'topology.db');

const store = require('../server/store');
const { db } = require('../server/db');

function node(name, parentIds = []) {
  return store.createNode({ name, type: 'physical', status: 'unknown', parentIds });
}

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stores multiple parents and rejects containment cycles', () => {
  const rack = node('rack');
  const network = node('network');
  const server = node('server', [rack.id, network.id]);

  assert.deepEqual(server.parentIds, [rack.id, network.id]);
  assert.deepEqual(store.getNode(server.id).parentIds, [rack.id, network.id]);
  assert.throws(
    () => store.updateNode(rack.id, { parentIds: [server.id] }),
    { code: 'cycle_detected' }
  );
});

test('stores graph positions and a reliable external URL for ports', () => {
  const host = node('port-host');
  const port = store.createPort(host.id, {
    portNumber: 443,
    serviceName: 'dashboard',
    externalUrl: 'https://dashboard.example.test/path',
    posX: 320,
    posY: 180,
  });

  assert.equal(port.externalUrl, 'https://dashboard.example.test/path');
  assert.equal(port.posX, 320);
  assert.equal(port.posY, 180);
  assert.throws(
    () => store.updatePort(port.id, { externalUrl: 'not a url' }),
    { code: 'validation_error' }
  );
});
