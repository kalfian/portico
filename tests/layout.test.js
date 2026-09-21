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
  const context = vm.createContext({
    state: { nodes: [{ id: 'n', posX: 10, posY: 20 }], ports: [{ id: 'a', nodeId: 'n', portNumber: 80 }, { id: 'b', nodeId: 'n', portNumber: 81 }] },
    auth: true, layoutDirty: false, REDUCE: true,
    document: { getElementById: () => ({ setAttribute() {}, removeAttribute() {}, style: {} }), addEventListener() {} },
    vis: { DataSet: class {}, Network: class {
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
    ${['requireEdit','markLayoutDirty','buildGraph','portGraphId','portVis','exposureModeLabel','replacePort','replaceNode','autoArrange'].map(extract).join('\n')}
    async ${extract('saveLayout')}
    async ${extract('reloadState')}
    buildGraph();`, context);
  return { context, handlers, writes, feedback, run: code => vm.runInContext(code, context) };
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
  assert.equal(h.context.state.ports[1].posX, undefined);
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
