'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/app.js', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const line = source.indexOf('\n', start);
  const end = source.slice(start, line).endsWith('}') ? line : source.indexOf('\n}', start) + 2;
  return source.slice(start, end);
}
function harness() {
  const handlers = {}, writes = [], feedback = [];
  const saveButton = { setAttribute() {}, removeAttribute() {}, style: {} };
  const context = vm.createContext({
    state: { nodes: [{ id: 'n', posX: 10, posY: 20 }], ports: [{ id: 'a', nodeId: 'n', portNumber: 80 }, { id: 'b', nodeId: 'n', portNumber: 81 }] },
    auth: true, layoutDirty: false, REDUCE: true, window: {},
    document: { getElementById: () => saveButton, addEventListener() {} },
    vis: { DataSet: class { getIds() { return []; } }, Network: class {
      on(event, fn) { handlers[event] = fn; }
      once(event, fn) { handlers[event] = fn; }
      getPositions() { return { n: { x: 100.2, y: 200.8 }, 'port:a': { x: 0, y: -90.4 }, 'port:b': { x: 230, y: 240 } }; }
      setOptions() {}
    } },
    graphNodes: () => [], buildEdges: () => [], setupSmoothZoom() {}, syncGraph() {}, setTimeout() {},
    EXPOSURE: { internal: { label: 'internal' } },
    api: { updateNode: async (id, p) => writes.push(['node', id, p]), updatePort: async (id, p) => writes.push(['port', id, p]) },
    toast: (...args) => feedback.push(args), openAuthModal: () => feedback.push('auth'),
  });
  vm.runInContext(`const canEdit = () => auth;
    function nodeById(id) { return state.nodes.find(n => n.id === id); }
    function portsFor(id) { return state.ports.filter(p => p.nodeId === id); }
    ${['separateGraphBoxes','resolveGraphOverlaps','requireEdit','markLayoutDirty','buildGraph','portGraphId','portVis','exposureModeLabel','replacePort','replaceNode','autoArrange'].map(extract).join('\n')}
    async ${extract('saveLayout')}
    async ${extract('reloadState')}
    buildGraph();`, context);
  return { context, handlers, writes, feedback, saveButton, run: code => vm.runInContext(code, context) };
}
test('node and owned port drags remain drafts until authenticated Save layout', async () => {
  const h = harness();
  h.handlers.dragEnd({ nodes: ['n', 'port:a'] });
  assert.equal(h.context.state.nodes[0].posY, 201);
  assert.equal(h.context.state.ports[0].posX, 0);
  assert.equal(h.context.state.ports[0].posY, -90);
  assert.equal(h.context.state.ports[0].nodeId, 'n');
  assert.equal(h.context.state.ports[1].posX, undefined);
  assert.equal(h.writes.length, 0);
  assert.equal(h.context.layoutDirty, true);
  h.context.auth = false;
  h.handlers.dragEnd({ nodes: ['port:b'] });
  assert.equal(h.context.state.ports[1].posX, 230);
  await h.run('saveLayout()');
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.feedback, ['auth']);
  h.context.auth = true;
  await h.run('saveLayout()');
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes.slice(0, 2))), [['node', 'n', { posX: 100, posY: 201 }], ['port', 'a', { posX: 0, posY: -90 }]]);
  assert.equal(h.context.layoutDirty, false);
});
test('port rendering uses saved zero coordinates and owner fallback; replacement and reload retain drafts', async () => {
  const h = harness();
  assert.equal(h.run('portVis(state.ports[0]).x'), -62.5);
  assert.equal(h.run('portVis(state.ports[1]).x'), 82.5);
  h.handlers.dragEnd({ nodes: ['n', 'port:a'] });
  h.run("replacePort({ id: 'a', nodeId: 'n', posX: 999, posY: 999, serviceName: 'updated' })");
  assert.equal(h.run('portVis(state.ports[0]).x'), 0);
  assert.equal(h.context.state.ports[0].serviceName, 'updated');
  h.context.api.topology = async () => ({ nodes: [{ id: 'n', posX: 1, posY: 2 }], ports: [{ id: 'a', nodeId: 'n', posX: 3, posY: 4 }] });
  await h.run('reloadState()');
  assert.equal(h.context.state.nodes[0].posX, 100);
  assert.equal(h.context.state.ports[0].posX, 0);
  h.context.layoutDirty = false;
  await h.run('reloadState()');
  assert.equal(h.run('portVis(state.ports[0]).x'), 3);
});
test('unsaved port cards wrap into compact rows while explicit positions still win', () => {
  const ports = Array.from({ length: 6 }, (_, i) => ({ id: String(i), nodeId: 'n', portNumber: 8000 + i, protocol: 'tcp', status: 'in_use', exposure: 'internal' }));
  ports[5].posX = 999; ports[5].posY = 888;
  const ctx = vm.createContext({
    state: { nodes: [{ id: 'n', posX: 100, posY: 50 }], ports },
    EXPOSURE: { internal: { label: 'internal' } },
    nodeById: id => id === 'n' ? { id: 'n', posX: 100, posY: 50 } : null,
    portsFor: () => ports,
  });
  vm.runInContext(`${extract('portGraphId')}\n${extract('exposureModeLabel')}\n${extract('portVis')}`, ctx);
  assert.equal(vm.runInContext("portVis(state.ports[0]).y", ctx), 185);
  assert.equal(vm.runInContext("portVis(state.ports[4]).y", ctx), 277);
  assert.equal(vm.runInContext("portVis(state.ports[4]).x", ctx), -117.5);
  assert.equal(vm.runInContext("portVis(state.ports[5]).x", ctx), 999);
  assert.equal(vm.runInContext("portVis(state.ports[5]).y", ctx), 888);
});
test('auto-arrange captures node and port drafts without writes; failed save retains drafts', async () => {
  const h = harness();
  h.run('autoArrange()');
  await h.handlers.afterDrawing();
  assert.equal(h.context.state.nodes[0].posX, 100);
  assert.equal(h.context.state.ports[1].posX, 230);
  assert.equal(h.context.state.ports[1].nodeId, 'n');
  assert.equal(h.writes.length, 0);
  h.context.api.updatePort = async () => { throw new Error('offline'); };
  await h.run('saveLayout()');
  assert.equal(h.context.layoutDirty, true);
  assert.match(h.feedback.at(-1)[0], /Could not save layout/);
});

test('readonly dragging is enabled and updates local node and port drafts', () => {
  const h = harness();
  h.context.auth = false;
  h.handlers.dragEnd({ nodes: ['n', 'port:a'] });
  assert.equal(h.context.state.nodes[0].posX, 100);
  assert.equal(h.context.state.ports[0].posX, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.saveButton.hidden, true);
  assert.doesNotMatch(extract('buildGraph'), /dragNodes: canEdit/);
  assert.doesNotMatch(extract('applyLockState'), /dragNodes: canEdit/);
  assert.match(extract('applyLockState'), /drag previews locally/);
});
test('fit camera keeps graph bounds inside banner and hint safe areas at audit viewport', () => {
  const ctx = vm.createContext({ ZOOM_MIN: 0.18, ZOOM_MAX: 3.2 });
  vm.runInContext(extract('graphFitCamera'), ctx);
  ctx.bounds = { left: -500, right: 500, top: -240, bottom: 240 };
  ctx.viewport = { width: 1280, height: 577 };
  ctx.insets = { top: 72, right: 32, bottom: 54, left: 32 };
  const camera = vm.runInContext('graphFitCamera(bounds, viewport, insets)', ctx);
  const project = (x, y) => ({
    x: (x - camera.position.x) * camera.scale + ctx.viewport.width / 2,
    y: (y - camera.position.y) * camera.scale + ctx.viewport.height / 2,
  });
  const topLeft = project(ctx.bounds.left, ctx.bounds.top);
  const bottomRight = project(ctx.bounds.right, ctx.bounds.bottom);
  assert.ok(topLeft.x >= ctx.insets.left);
  assert.ok(topLeft.y >= ctx.insets.top);
  assert.ok(bottomRight.x <= ctx.viewport.width - ctx.insets.right);
  assert.ok(bottomRight.y <= ctx.viewport.height - ctx.insets.bottom);
  assert.ok((topLeft.y + bottomRight.y) / 2 > ctx.viewport.height / 2, 'asymmetric overlays shift the graph into the safe viewport');
  assert.match(source, /btnFit'\)\.addEventListener\('click', \(\) => fitGraph/);
  assert.doesNotMatch(source, /network\.fit/);
});
test('collision placement is deterministic, bounded and stable for mixed element sizes', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract('separateGraphBoxes'), ctx);
  const boxes = Array.from({ length: 60 }, (_, i) => ({ id: i % 2 ? 'port:' + i : 'n' + i, x: 0, y: 0, left: -30, right: 30 + i, top: -20, bottom: 20 }));
  ctx.boxes = boxes;
  const result = vm.runInContext('separateGraphBoxes(boxes)', ctx);
  assert.equal(JSON.stringify(result), JSON.stringify(vm.runInContext('separateGraphBoxes(boxes)', ctx)));
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
    const a = result[i], b = result[j];
    assert.ok(a.x + a.right + 12 <= b.x + b.left || b.x + b.right + 12 <= a.x + a.left || a.y + a.bottom + 12 <= b.y + b.top || b.y + b.bottom + 12 <= a.y + a.top);
  }
  ctx.boxes = result;
  assert.equal(JSON.stringify(result), JSON.stringify(vm.runInContext('separateGraphBoxes(boxes)', ctx)));
});
test('host goto is independent of port domains and LAN ignores stale Cloudflare domains', () => {
  const ctx = vm.createContext({ portsFor: () => [{ domain: 'service.example' }], inferScheme: () => 'http' });
  vm.runInContext(extract('nodeUrl') + '\n' + extract('portUrl'), ctx);
  assert.equal(vm.runInContext("nodeUrl({id:'n', ipAddress:'10.0.0.1'})", ctx), 'http://10.0.0.1');
  assert.equal(vm.runInContext("nodeUrl({id:'n'})", ctx), null);
  assert.equal(vm.runInContext("portUrl({ipAddress:'10.0.0.1'}, {status:'in_use', exposureMode:'lan', domain:'stale.example', portNumber:80})", ctx), 'http://10.0.0.1:80');
});
test('graph port selection retains port identity and table details offer destination links', () => {
  const ctx = vm.createContext({ state: { ports: [{id:'a',nodeId:'n'}] }, portGraphId: p => 'port:' + p.id, relatedIds: () => new Set(), syncGraph() {}, openSidebar() {}, network: null, renderDetail() {}, markTableSelection() {}, startFlow() {} });
  vm.runInContext(extract('select') + "\nselect('port:a')", ctx);
  assert.equal(ctx.selectedId, 'port:a');
  assert.match(extract('renderTableRows'), /portOpenLink/);
});

test('empty table port details render the no-ports message once', () => {
  const body = { innerHTML: '', querySelectorAll: () => [] };
  const ctx = vm.createContext({
    state: { nodes: [{ id: 'world' }], ports: [] },
    tablePortsCollapsed: new Set(),
    tableQ: '', tableScope: 'all',
    document: {
      getElementById: id => id === 'tableBody' ? body : null,
      querySelector: () => null,
    },
    filteredSortedNodes: () => [{ id: 'world' }],
    ownedPorts: () => [],
    tableRowHtml: () => '<tr><td>world</td></tr>',
    esc: value => String(value),
  });
  vm.runInContext(`${extract('renderTableRows')}\nrenderTableRows()`, ctx);
  assert.equal((body.innerHTML.match(/<span class="muted">No ports recorded<\/span>/g) || []).length, 1);
});

test('operator inventory filter searches app ports, targets and explicit Cloudflare routes', () => {
  const ctx = vm.createContext({
    state: {
      nodes: [{id:'app',name:'Photos',ipAddress:'10.0.0.2'}, {id:'target',name:'Storage',ipAddress:'10.0.0.3'}],
      ports: [{id:'p',nodeId:'app',serviceName:'immich',portNumber:2283,protocol:'tcp',targetNodeId:'target',exposureMode:'cloudflare',cloudflareRouteId:'cf'}],
      cloudflareRoutes: [{id:'cf',hostname:'photos.example.com',target:'http://10.0.0.2:2283'}],
    },
    tableScope: 'all', TYPES: {}, nwById: () => null,
  });
  vm.runInContext(`function nodeById(id) { return state.nodes.find(n => n.id === id); }\n${['cloudflareRouteById','isCloudflarePort','ownedPorts','nodeMatchesInventory'].map(extract).join('\n')}`, ctx);
  assert.equal(vm.runInContext("nodeMatchesInventory(state.nodes[0], 'photos.example.com')", ctx), true);
  assert.equal(vm.runInContext("nodeMatchesInventory(state.nodes[0], 'storage')", ctx), true);
  ctx.tableScope = 'unlinked';
  assert.equal(vm.runInContext("nodeMatchesInventory(state.nodes[0], '')", ctx), false);
  ctx.state.ports[0].cloudflareRouteId = null;
  assert.equal(vm.runInContext("nodeMatchesInventory(state.nodes[0], '')", ctx), true);
});
test('global search finds ports through route and forwarding metadata', () => {
  const ctx = vm.createContext({
    state: {
      nodes: [{ id: 'owner', name: 'Host' }, { id: 'target', name: 'Storage', ipAddress: '10.0.0.9' }],
      ports: [{ id: 'p', nodeId: 'owner', serviceName: 'photos', portNumber: 2283, targetNodeId: 'target', cloudflareRouteId: 'cf' }],
      cloudflareRoutes: [{ id: 'cf', hostname: 'photos.example.com', target: 'http://10.0.0.9:2283' }],
    },
  });
  vm.runInContext(`function nodeById(id) { return state.nodes.find(n => n.id === id); }\n${extract('cloudflareRouteById')}\n${extract('runSearch')}`, ctx);
  assert.equal(vm.runInContext("runSearch('photos.example.com').ports[0].id", ctx), 'p');
  assert.equal(vm.runInContext("runSearch('10.0.0.9').ports[0].id", ctx), 'p');
  ctx.state.cloudflareRoutes = undefined;
  assert.equal(vm.runInContext("runSearch('photos').ports[0].id", ctx), 'p');
  assert.match(source, /cloudflareRoutes: result\.cloudflareRoutes \|\| \[\]/);
});

test('render and dragging resolve visible mixed collisions as drafts without changing ownership', () => {
  const h = harness();
  h.context.auth = false;
  h.context.drawFlow = () => {};
  h.run(`
    var points = { n: { x: 0, y: 0 }, 'port:a': { x: 0, y: 0 } };
    nodesDS.getIds = () => Object.keys(points);
    nodesDS.update = updates => updates.forEach(p => { points[p.id] = { x: p.x, y: p.y }; });
    network.getPositions = () => points;
    network.getBoundingBox = id => ({ left: points[id].x - 50, right: points[id].x + 50, top: points[id].y - 30, bottom: points[id].y + 30 });
  `);
  h.handlers.afterDrawing();
  assert.ok(Math.abs(h.context.points['port:a'].x) >= 112 || Math.abs(h.context.points['port:a'].y) >= 72);
  const first = JSON.stringify(h.context.points);
  h.handlers.afterDrawing();
  assert.equal(JSON.stringify(h.context.points), first);
  h.run("points['port:a'] = {x:0,y:0}");
  h.handlers.dragging({ nodes: ['port:a'] });
  assert.equal(h.context.points.n.x, 0);
  assert.equal(h.context.points.n.y, 0);
  assert.notEqual(JSON.stringify(h.context.points['port:a']), JSON.stringify(h.context.points.n));
  assert.equal(h.context.state.ports[0].nodeId, 'n');
  assert.equal(h.context.state.ports[1].posX, undefined);
  assert.equal(h.writes.length, 0);
  assert.equal(h.saveButton.hidden, true);
});
test('port details expose destination and preserve owner, parent, target and state', () => {
  const nodes = [{id:'owner',name:'Host',ipAddress:'10.0.0.1',parentId:'parent'}, {id:'parent',name:'Parent'}, {id:'target',name:'Target'}];
  const ctx = vm.createContext({ state: { cloudflareRoutes: [{id:'route',hostname:'service.example',target:'http://target:443'}] }, nodeById: id => nodes.find(n => n.id === id), esc: s => String(s ?? ''), inferScheme: () => 'https' });
  vm.runInContext(['cloudflareRouteById','isCloudflarePort','renderPortDetail','portOpenLink','portUrl','exposureModeLabel'].map(extract).join('\n'), ctx);
  ctx.el = { querySelectorAll: () => [] };
  ctx.port = { nodeId:'owner',targetNodeId:'target',portNumber:443,protocol:'tcp',status:'in_use',exposureMode:'cloudflare',domain:'service.example',exposure:'public',cloudflareRouteId:'route' };
  vm.runInContext('renderPortDetail(el, port)', ctx);
  assert.match(ctx.el.innerHTML, /href="https:\/\/service.example"/);
  assert.match(ctx.el.innerHTML, /service.example → http:\/\/target:443/);
  for (const id of ['owner','parent','target']) assert.ok(ctx.el.innerHTML.includes(`data-goto="${id}"`));
  assert.match(ctx.el.innerHTML, /in_use/);
  ctx.port.status = 'reserved';
  vm.runInContext('renderPortDetail(el, port)', ctx);
  assert.doesNotMatch(ctx.el.innerHTML, /href=/);
});
