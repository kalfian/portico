'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vm = require('node:vm');

test('fresh database API: ownership, statuses, exposure, cycles, auth and round trip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portico-test-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DB_PATH: path.join(dir, 'fresh.db'), PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    // Server supports an ephemeral port for isolated verification.
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Server exited before ready')); });
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    let cookie = '';
    async function request(url, method = 'GET', body, expected = 200, authenticated = true) {
      const res = await fetch(`http://127.0.0.1:${port}/api${url}`, {
        method, headers: { 'Content-Type': 'application/json', ...(authenticated && cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      assert.equal(res.status, expected, JSON.stringify(data));
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return data;
    }
    await request('/nodes', 'POST', { name: 'unauthorized' }, 401, false);
    await request('/auth/setup', 'POST', { password: 'test-only-password-123' }, 201);
    const root = await request('/nodes', 'POST', { name: 'Test root' }, 201);
    const a = await request('/nodes', 'POST', { name: 'Child A', parentId: root.id }, 201);
    const b = await request('/nodes', 'POST', { name: 'Child B', parentId: root.id }, 201);
    assert.equal(a.parentId, root.id);
    assert.equal(b.parentId, root.id);
    await request(`/nodes/${root.id}`, 'PUT', { parentId: a.id }, 400);
    await request(`/nodes/${a.id}`, 'PUT', { parentId: a.id }, 400);
    await request(`/nodes/${a.id}`, 'PUT', { parentId: null });
    await request(`/nodes/${a.id}`, 'PUT', { parentId: root.id });
    for (const [i, status] of ['in_use', 'reserved', 'active', 'up', 'inactive', 'down'].entries()) {
      const p = await request(`/nodes/${root.id}/ports`, 'POST', {
        portNumber: 8100 + i, protocol: i % 2 ? 'udp' : 'tcp', serviceName: `service-${i}`, status,
        exposureMode: i === 0 ? 'cloudflare' : 'lan', domain: i === 0 ? 'test.example.com' : '',
      }, 201);
      assert.equal(p.status, status);
      assert.equal(p.nodeId, root.id);
      assert.equal(p.exposureMode, i === 0 ? 'cloudflare' : 'lan');
      const updated = await request(`/ports/${p.id}`, 'PUT', { description: 'edited' });
      assert.equal(updated.status, status);
      assert.equal(updated.exposureMode, p.exposureMode);
    }
    assert.equal((await request(`/nodes/${root.id}/ports`)).length, 6);
    await request(`/nodes/${root.id}/ports`, 'POST', { portNumber: 8100, protocol: 'tcp' }, 409);
    await request(`/nodes/${root.id}/ports`, 'POST', { portNumber: 0 }, 400);
    await request(`/nodes/${root.id}/ports`, 'POST', { portNumber: 9999, exposureMode: 'invalid' }, 400);
    await request(`/nodes/${root.id}`, 'PUT', { posX: 123, posY: 456 }, 401, false);
    assert.equal((await request(`/nodes/${root.id}`)).posX, 0);
    await request(`/nodes/${root.id}`, 'PUT', { posX: 123, posY: 456 });
    assert.equal((await request(`/nodes/${root.id}`)).posX, 123);
    await request(`/nodes/${root.id}/ports`, 'POST', { portNumber: 9999, exposureMode: 'cloudflare' }, 400);
    const modePort = (await request(`/nodes/${root.id}/ports`))[0];
    const local = await request(`/ports/${modePort.id}`, 'PUT', { exposureMode: 'lan' });
    assert.equal(local.domain, '');
    assert.equal(local.exposure, 'lan');
    const remote = await request(`/ports/${modePort.id}`, 'PUT', { domain: 'changed.example.com' });
    assert.equal(remote.exposureMode, 'cloudflare');
    const applied = await request('/import/apply', 'POST', {
      nodes: [{ ref: 'guest', name: 'Imported guest', type: 'lxc', source: 'proxmox', externalId: '999' }],
      ports: [{ nodeRef: 'guest', portNumber: 8080, protocol: 'tcp', status: 'up', source: 'proxmox-description' }],
      parentId: root.id,
    });
    assert.equal(applied.nodes.created.length, 1);
    assert.equal(applied.ports.created.length, 1);
    const guest = await request(`/nodes/${applied.nodes.created[0].id}`);
    assert.equal(guest.source, 'proxmox');
    assert.equal(guest.parentId, root.id);
    assert.equal((await request(`/nodes/${guest.id}/ports`))[0].source, 'proxmox-description');
    const before = await request('/export');
    const cyclic = structuredClone(before);
    cyclic.nodes.find(n => n.id === root.id).parentId = a.id;
    await request('/import', 'POST', cyclic, 400);
    assert.deepEqual(await request('/export'), before);
    await request('/import', 'POST', before);
    assert.deepEqual(await request('/export'), before);
    const topology = await request('/topology');
    assert.equal(topology.edges.filter(e => e.from === root.id && e.kind === 'port_ownership').length, 6);
    assert.equal(topology.nodes.filter(n => n.parentId === root.id).length, 3);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('graph port retention and independent collapse; drag draft persistence guard', async () => {
  const source = fs.readFileSync('public/app.js', 'utf8');
  function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end + 2);
  }
  const context = vm.createContext({
    state: { nodes: [{ id: 'root' }, { id: 'child', parentId: 'root' }], ports: [{ id: 'p1', nodeId: 'root' }, { id: 'p2', nodeId: 'root' }, { id: 'p3', nodeId: 'child' }] },
    tableCollapsed: new Set(), tablePortsCollapsed: new Set(), edgeToggles: {},
    nodeVis: n => n, portVis: p => ({ ...p, id: 'port:' + p.id }),
  });
  vm.runInContext(`function nodeById(id) { return state.nodes.find(n => n.id === id); }\n${extract('hasCollapsedTableAncestor')}\n${extract('graphNodes')}`, context);
  const ids = () => Array.from(vm.runInContext('graphNodes().map(n => n.id)', context));
  assert.deepEqual(ids(), ['root', 'child', 'port:p1', 'port:p2', 'port:p3']);
  context.tableCollapsed.add('root');
  assert.deepEqual(ids(), ['root', 'port:p1', 'port:p2']);
  context.tableCollapsed.clear(); context.tablePortsCollapsed.add('root');
  assert.deepEqual(ids(), ['root', 'child', 'port:p3']);
  context.tablePortsCollapsed.clear(); context.edgeToggles.port_ownership = false;
  assert.deepEqual(ids(), ['root', 'child']);
  assert.match(extract('syncGraph'), /nodesDS.add\(graphNodes\(\)\)/);
  const writes = [];
  const button = { setAttribute() {}, removeAttribute() {} };
  Object.assign(context, { requireEdit: () => false, layoutDirty: true,
    document: { getElementById: () => button }, api: { updateNode: async (...args) => writes.push(args) }, toast() {} });
  vm.runInContext('async ' + extract('saveLayout'), context);
  await vm.runInContext('saveLayout()', context);
  assert.equal(writes.length, 0);
  assert.equal(context.layoutDirty, true);
  context.requireEdit = () => true;
  await vm.runInContext('saveLayout()', context);
  assert.equal(writes.length, 2);
  assert.equal(context.layoutDirty, false);
  assert.match(extract('saveLayout'), /if \(!requireEdit\(\) \|\| !layoutDirty\) return/);
  const drag = source.slice(source.indexOf("network.on('dragEnd'"), source.indexOf("network.on('dragEnd'") + 900);
  assert.match(drag, /markLayoutDirty/);
  assert.doesNotMatch(drag, /api\.updateNode/);
});

test('migration preserves inventory provenance, Cloudflare routes and legacy ports', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try {
    for (const file of fs.readdirSync('server/migrations').sort().filter(f => /^00[1-7]_/.test(f))) {
      db.exec(fs.readFileSync(path.join('server/migrations', file), 'utf8'));
    }
    db.exec(`INSERT INTO nodes (id,name,type,source,external_id,created_at,updated_at) VALUES ('host','Host','proxmox_host','proxmox','100','now','now');
      INSERT INTO cloudflare_routes (id,hostname,created_at,updated_at) VALUES ('route','test.example.com','now','now');
      INSERT INTO ports (id,node_id,port_number,domain,cloudflare_route_id,source,external_id,created_at,updated_at)
      VALUES ('web','host',443,'test.example.com','route','proxmox','service','now','now'), ('ssh','host',22,'',NULL,'proxmox','ssh','now','now');`);
    const inventory = db.prepare('SELECT * FROM nodes').all();
    const routes = db.prepare('SELECT * FROM cloudflare_routes').all();
    const ports = db.prepare('SELECT * FROM ports ORDER BY id').all();
    db.exec(fs.readFileSync('server/migrations/008_port_exposure_mode.sql', 'utf8'));
    assert.deepEqual(db.prepare('SELECT * FROM nodes').all(), inventory);
    assert.deepEqual(db.prepare('SELECT * FROM cloudflare_routes').all(), routes);
    const migrated = db.prepare('SELECT * FROM ports ORDER BY id').all();
    assert.deepEqual(migrated.map(({ exposure_mode, ...p }) => p), ports);
    assert.deepEqual(migrated.map(p => p.exposure_mode), ['lan', 'cloudflare']);
  } finally { db.close(); }
});
