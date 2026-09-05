'use strict';

// Data-access + business logic. Routes stay thin; all SQL and guards live here.
// Throws ApiError(status, msg) for client-facing failures.

const { db } = require('./db');
const { uid, now, isValidIpv4, ApiError, ipToInt, intToIp, parseCidr } = require('./lib/util');
const E = require('./lib/enums');
const { nodeToApi, portToApi, networkToApi, linkToApi } = require('./lib/mappers');

// ------------------------------------------------------------------ helpers

function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ApiError(400, `Invalid ${field}: "${value}". Allowed: ${allowed.join(', ')}`);
  }
}

// Translate SQLite constraint failures into clean HTTP errors.
function mapDbError(err) {
  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    if (String(err.message).includes('ports.'))
      return new ApiError(409, 'A port with this (portNumber, protocol) already exists on the node', 'port_conflict');
    return new ApiError(409, 'Unique constraint violated', 'conflict');
  }
  if (err && err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return new ApiError(400, 'Referenced record does not exist (foreign key)');
  }
  return err;
}

// ------------------------------------------------------------------ tags

function getTagsForNode(nodeId) {
  return db
    .prepare('SELECT t.name FROM tags t JOIN node_tags nt ON nt.tag_id = t.id WHERE nt.node_id = ? ORDER BY nt.rowid')
    .all(nodeId)
    .map((r) => r.name);
}

const insTag = db.prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)');
const selTag = db.prepare('SELECT id FROM tags WHERE name = ?');
const insNodeTag = db.prepare('INSERT OR IGNORE INTO node_tags(node_id, tag_id) VALUES (?, ?)');
const delNodeTags = db.prepare('DELETE FROM node_tags WHERE node_id = ?');

function setTagsForNode(nodeId, tags) {
  delNodeTags.run(nodeId);
  const names = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const name = String(raw || '').trim();
    if (!name || names.includes(name)) continue;
    names.push(name);
    insTag.run(name);
    const id = selTag.get(name).id;
    insNodeTag.run(nodeId, id);
  }
}

// ------------------------------------------------------------------ nodes

function getNodeRow(id) {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
}

function listNodes() {
  const rows = db.prepare('SELECT * FROM nodes ORDER BY created_at, rowid').all();
  return rows.map((r) => nodeToApi(r, getTagsForNode(r.id)));
}

function getNode(id) {
  const row = getNodeRow(id);
  if (!row) throw new ApiError(404, 'Node not found');
  return nodeToApi(row, getTagsForNode(id));
}

// Walk up from `startParentId`; if we ever reach `nodeId`, setting it as parent forms a cycle.
function wouldCreateCycle(nodeId, startParentId) {
  let cur = startParentId;
  const seen = new Set();
  while (cur) {
    if (cur === nodeId) return true;
    if (seen.has(cur)) break; // pre-existing loop guard
    seen.add(cur);
    const row = getNodeRow(cur);
    cur = row ? row.parent_id : null;
  }
  return false;
}

function validateNodeFields(f) {
  if (!f.name || !String(f.name).trim()) throw new ApiError(400, 'name is required');
  assertEnum(f.type, E.NODE_TYPES, 'type');
  assertEnum(f.status, E.NODE_STATUS, 'status');
  assertEnum(f.iconType, E.ICON_TYPES, 'iconType');
  if (!isValidIpv4(f.ipAddress)) throw new ApiError(400, `Invalid IPv4 address: "${f.ipAddress}"`);
}

// Resolve final field values for create/update: overlay body onto defaults/existing.
function resolveNodeFields(body, existing) {
  const base = existing || {
    name: '', type: 'physical', parent_id: null, ip_address: '', mac_address: '',
    os: '', role: '', status: 'unknown', network_id: null, icon_type: '', icon_value: '',
    notes: '', pos_x: 0, pos_y: 0,
  };
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  return {
    name: has('name') ? body.name : base.name,
    type: has('type') ? body.type : base.type,
    parentId: has('parentId') ? body.parentId : base.parent_id,
    ipAddress: has('ipAddress') ? body.ipAddress : base.ip_address,
    macAddress: has('macAddress') ? body.macAddress : base.mac_address,
    os: has('os') ? body.os : base.os,
    role: has('role') ? body.role : base.role,
    status: has('status') ? body.status : base.status,
    networkId: has('networkId') ? body.networkId : base.network_id,
    iconType: has('iconType') ? body.iconType : base.icon_type,
    iconValue: has('iconValue') ? body.iconValue : base.icon_value,
    notes: has('notes') ? body.notes : base.notes,
    posX: has('posX') ? body.posX : base.pos_x,
    posY: has('posY') ? body.posY : base.pos_y,
    tags: has('tags') ? body.tags : undefined, // undefined = leave as-is on update
  };
}

const insNode = db.prepare(`
  INSERT INTO nodes (id, name, type, parent_id, ip_address, mac_address, os, role, status,
                     network_id, icon_type, icon_value, notes, pos_x, pos_y, last_seen, created_at, updated_at)
  VALUES (@id, @name, @type, @parent_id, @ip_address, @mac_address, @os, @role, @status,
          @network_id, @icon_type, @icon_value, @notes, @pos_x, @pos_y, @last_seen, @created_at, @updated_at)
`);

function createNode(body, providedId) {
  const f = resolveNodeFields(body, null);
  validateNodeFields(f);
  const id = providedId || body.id || uid('n');
  if (f.parentId) {
    if (f.parentId === id) throw new ApiError(400, 'A node cannot be its own parent', 'cycle_detected');
    if (wouldCreateCycle(id, f.parentId)) throw new ApiError(400, 'parentId would create a cycle', 'cycle_detected');
  }
  const ts = now();
  const run = db.transaction(() => {
    try {
      insNode.run({
        id, name: String(f.name).trim(), type: f.type, parent_id: f.parentId || null,
        ip_address: f.ipAddress || '', mac_address: f.macAddress || '', os: f.os || '',
        role: f.role || '', status: f.status, network_id: f.networkId || null,
        icon_type: f.iconType || '', icon_value: f.iconValue || '', notes: f.notes || '',
        pos_x: Number(f.posX) || 0, pos_y: Number(f.posY) || 0, last_seen: null, created_at: ts, updated_at: ts,
      });
    } catch (err) { throw mapDbError(err); }
    setTagsForNode(id, f.tags || []);
  });
  run();
  return getNode(id);
}

const updNode = db.prepare(`
  UPDATE nodes SET name=@name, type=@type, parent_id=@parent_id, ip_address=@ip_address,
    mac_address=@mac_address, os=@os, role=@role, status=@status, network_id=@network_id,
    icon_type=@icon_type, icon_value=@icon_value, notes=@notes, pos_x=@pos_x, pos_y=@pos_y,
    updated_at=@updated_at
  WHERE id=@id
`);

function updateNode(id, body) {
  const existing = getNodeRow(id);
  if (!existing) throw new ApiError(404, 'Node not found');
  const f = resolveNodeFields(body, existing);
  validateNodeFields(f);
  if (f.parentId) {
    if (f.parentId === id) throw new ApiError(400, 'A node cannot be its own parent', 'cycle_detected');
    if (wouldCreateCycle(id, f.parentId)) throw new ApiError(400, 'parentId would create a cycle', 'cycle_detected');
  }
  const run = db.transaction(() => {
    try {
      updNode.run({
        id, name: String(f.name).trim(), type: f.type, parent_id: f.parentId || null,
        ip_address: f.ipAddress || '', mac_address: f.macAddress || '', os: f.os || '',
        role: f.role || '', status: f.status, network_id: f.networkId || null,
        icon_type: f.iconType || '', icon_value: f.iconValue || '', notes: f.notes || '',
        pos_x: Number(f.posX) || 0, pos_y: Number(f.posY) || 0, updated_at: now(),
      });
    } catch (err) { throw mapDbError(err); }
    if (f.tags !== undefined) setTagsForNode(id, f.tags);
  });
  run();
  return getNode(id);
}

// Delete a node; direct children reparent to the deleted node's parent (grandparent),
// matching the prototype. Ports/links/node_tags cascade via FK; incoming targetNodeId → NULL.
function deleteNode(id) {
  const existing = getNodeRow(id);
  if (!existing) throw new ApiError(404, 'Node not found');
  const run = db.transaction(() => {
    db.prepare('UPDATE nodes SET parent_id = ?, updated_at = ? WHERE parent_id = ?')
      .run(existing.parent_id || null, now(), id);
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  });
  run();
  return { id, deleted: true };
}

// ------------------------------------------------------------------ ports

function getPortRow(id) {
  return db.prepare('SELECT * FROM ports WHERE id = ?').get(id);
}

function listPortsForNode(nodeId) {
  if (!getNodeRow(nodeId)) throw new ApiError(404, 'Node not found');
  return db.prepare('SELECT * FROM ports WHERE node_id = ? ORDER BY port_number, protocol').all(nodeId).map(portToApi);
}

function inferScheme(f) {
  if (f.domain) return 'https';
  if (Number(f.portNumber) === 443 || Number(f.portNumber) === 8443) return 'https';
  return 'http';
}

function resolvePortFields(body, existing) {
  const base = existing || {
    port_number: null, protocol: 'tcp', service_name: '', description: '', status: 'in_use',
    domain: '', exposure: 'internal', scheme: 'http', host_port: null, target_node_id: null,
  };
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const f = {
    portNumber: has('portNumber') ? body.portNumber : base.port_number,
    protocol: has('protocol') ? body.protocol : base.protocol,
    serviceName: has('serviceName') ? body.serviceName : base.service_name,
    description: has('description') ? body.description : base.description,
    status: has('status') ? body.status : base.status,
    domain: has('domain') ? body.domain : base.domain,
    exposure: has('exposure') ? body.exposure : base.exposure,
    scheme: has('scheme') ? body.scheme : base.scheme,
    hostPort: has('hostPort') ? body.hostPort : base.host_port,
    targetNodeId: has('targetNodeId') ? body.targetNodeId : base.target_node_id,
  };
  // A domain implies internet-reachable (prototype normalizePort rule).
  if (f.domain && f.exposure !== 'public') f.exposure = 'public';
  if (!E.PORT_SCHEME.includes(f.scheme)) f.scheme = inferScheme(f);
  return f;
}

function validatePortFields(f) {
  const n = Number(f.portNumber);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ApiError(400, 'portNumber must be an integer 1..65535');
  assertEnum(f.protocol, E.PORT_PROTOCOLS, 'protocol');
  assertEnum(f.status, E.PORT_STATUS, 'status');
  assertEnum(f.exposure, E.PORT_EXPOSURE, 'exposure');
  assertEnum(f.scheme, E.PORT_SCHEME, 'scheme');
  if (f.hostPort !== null && f.hostPort !== undefined && f.hostPort !== '') {
    const hp = Number(f.hostPort);
    if (!Number.isInteger(hp) || hp < 1 || hp > 65535) throw new ApiError(400, 'hostPort must be an integer 1..65535 or null');
  }
}

const insPort = db.prepare(`
  INSERT INTO ports (id, node_id, port_number, protocol, service_name, description, status,
                     domain, exposure, scheme, host_port, target_node_id, last_seen, created_at, updated_at)
  VALUES (@id, @node_id, @port_number, @protocol, @service_name, @description, @status,
          @domain, @exposure, @scheme, @host_port, @target_node_id, @last_seen, @created_at, @updated_at)
`);

function createPort(nodeId, body) {
  if (!getNodeRow(nodeId)) throw new ApiError(404, 'Node not found');
  const f = resolvePortFields(body, null);
  validatePortFields(f);
  const id = body.id || uid('p');
  const ts = now();
  try {
    insPort.run({
      id, node_id: nodeId, port_number: Number(f.portNumber), protocol: f.protocol,
      service_name: f.serviceName || '', description: f.description || '', status: f.status,
      domain: f.domain || '', exposure: f.exposure, scheme: f.scheme,
      host_port: f.hostPort === '' || f.hostPort === undefined ? null : (f.hostPort === null ? null : Number(f.hostPort)),
      target_node_id: f.targetNodeId || null, last_seen: null, created_at: ts, updated_at: ts,
    });
  } catch (err) { throw mapDbError(err); }
  return portToApi(getPortRow(id));
}

const updPort = db.prepare(`
  UPDATE ports SET port_number=@port_number, protocol=@protocol, service_name=@service_name,
    description=@description, status=@status, domain=@domain, exposure=@exposure, scheme=@scheme,
    host_port=@host_port, target_node_id=@target_node_id, updated_at=@updated_at
  WHERE id=@id
`);

function updatePort(id, body) {
  const existing = getPortRow(id);
  if (!existing) throw new ApiError(404, 'Port not found');
  const f = resolvePortFields(body, existing);
  validatePortFields(f);
  try {
    updPort.run({
      id, port_number: Number(f.portNumber), protocol: f.protocol, service_name: f.serviceName || '',
      description: f.description || '', status: f.status, domain: f.domain || '', exposure: f.exposure,
      scheme: f.scheme,
      host_port: f.hostPort === '' || f.hostPort === undefined ? null : (f.hostPort === null ? null : Number(f.hostPort)),
      target_node_id: f.targetNodeId || null, updated_at: now(),
    });
  } catch (err) { throw mapDbError(err); }
  return portToApi(getPortRow(id));
}

function deletePort(id) {
  const existing = getPortRow(id);
  if (!existing) throw new ApiError(404, 'Port not found');
  db.prepare('DELETE FROM ports WHERE id = ?').run(id);
  return { id, deleted: true };
}

// Free ports in [from,to] for a node/protocol = range minus recorded port_numbers.
function freePorts(nodeId, { from, to, protocol } = {}) {
  if (!getNodeRow(nodeId)) throw new ApiError(404, 'Node not found');
  let lo = Number.isFinite(Number(from)) ? Number(from) : 8000;
  let hi = Number.isFinite(Number(to)) ? Number(to) : 9000;
  lo = Math.max(1, Math.min(65535, Math.trunc(lo)));
  hi = Math.max(1, Math.min(65535, Math.trunc(hi)));
  if (hi < lo) [lo, hi] = [hi, lo];
  const proto = protocol || 'tcp';
  assertEnum(proto, E.PORT_PROTOCOLS, 'protocol');
  const usedRows = db.prepare('SELECT port_number FROM ports WHERE node_id = ? AND protocol = ?').all(nodeId, proto);
  const used = new Set(usedRows.map((r) => r.port_number));
  const free = [];
  for (let p = lo; p <= hi; p++) if (!used.has(p)) free.push(p);
  return {
    nodeId, from: lo, to: hi, protocol: proto,
    used: [...used].filter((p) => p >= lo && p <= hi).sort((a, b) => a - b),
    free, freeCount: free.length,
  };
}

// ------------------------------------------------------------------ networks

function getNetworkRow(id) {
  return db.prepare('SELECT * FROM networks WHERE id = ?').get(id);
}

function listNetworks() {
  return db.prepare('SELECT * FROM networks ORDER BY created_at, rowid').all().map(networkToApi);
}

function validateNetworkFields(f) {
  if (!f.name || !String(f.name).trim()) throw new ApiError(400, 'name is required');
  if (f.cidr && !parseCidr(f.cidr)) throw new ApiError(400, `Invalid CIDR: "${f.cidr}"`);
  if (f.vlanId !== null && f.vlanId !== undefined && f.vlanId !== '') {
    const v = Number(f.vlanId);
    if (!Number.isInteger(v) || v < 0 || v > 4094) throw new ApiError(400, 'vlanId must be an integer 0..4094 or null');
  }
}

function resolveNetworkFields(body, existing) {
  const base = existing || { name: '', cidr: '', vlan_id: null, color: '' };
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  return {
    name: has('name') ? body.name : base.name,
    cidr: has('cidr') ? body.cidr : base.cidr,
    vlanId: has('vlanId') ? body.vlanId : base.vlan_id,
    color: has('color') ? body.color : base.color,
  };
}

const insNetwork = db.prepare(`
  INSERT INTO networks (id, name, cidr, vlan_id, color, created_at, updated_at)
  VALUES (@id, @name, @cidr, @vlan_id, @color, @created_at, @updated_at)
`);

function createNetwork(body) {
  const f = resolveNetworkFields(body, null);
  validateNetworkFields(f);
  const id = body.id || uid('nw');
  const ts = now();
  const vlan = f.vlanId === '' || f.vlanId === undefined ? null : (f.vlanId === null ? null : Number(f.vlanId));
  try {
    insNetwork.run({ id, name: String(f.name).trim(), cidr: f.cidr || '', vlan_id: vlan, color: f.color || '', created_at: ts, updated_at: ts });
  } catch (err) { throw mapDbError(err); }
  return networkToApi(getNetworkRow(id));
}

const updNetwork = db.prepare(`
  UPDATE networks SET name=@name, cidr=@cidr, vlan_id=@vlan_id, color=@color, updated_at=@updated_at WHERE id=@id
`);

function updateNetwork(id, body) {
  const existing = getNetworkRow(id);
  if (!existing) throw new ApiError(404, 'Network not found');
  const f = resolveNetworkFields(body, existing);
  validateNetworkFields(f);
  const vlan = f.vlanId === '' || f.vlanId === undefined ? null : (f.vlanId === null ? null : Number(f.vlanId));
  updNetwork.run({ id, name: String(f.name).trim(), cidr: f.cidr || '', vlan_id: vlan, color: f.color || '', updated_at: now() });
  return networkToApi(getNetworkRow(id));
}

function deleteNetwork(id) {
  if (!getNetworkRow(id)) throw new ApiError(404, 'Network not found');
  db.prepare('DELETE FROM networks WHERE id = ?').run(id); // nodes.network_id → NULL via FK
  return { id, deleted: true };
}

// Free host IPs in a network's CIDR = usable range minus IPs already assigned to nodes.
function freeIps(id, { limit } = {}) {
  const row = getNetworkRow(id);
  if (!row) throw new ApiError(404, 'Network not found');
  const c = parseCidr(row.cidr);
  if (!c) throw new ApiError(400, 'Network has no valid CIDR');
  const cap = Math.max(1, Math.min(4096, Number.isFinite(Number(limit)) ? Number(limit) : 256));
  const used = new Set(
    db.prepare('SELECT ip_address FROM nodes WHERE ip_address <> ?').all('')
      .map((r) => ipToInt(r.ip_address))
      .filter((v) => v != null && ((v & c.mask) >>> 0) === c.base)
  );
  const size = c.prefix >= 31 ? 2 ** (32 - c.prefix) : 2 ** (32 - c.prefix);
  // Usable host range: exclude network address and broadcast for prefixes < 31.
  const first = c.prefix < 31 ? c.base + 1 : c.base;
  const last = c.prefix < 31 ? c.base + size - 2 : c.base + size - 1;
  const free = [];
  let total = 0;
  for (let v = first >>> 0; v <= (last >>> 0) && free.length < cap; v++) {
    total++;
    if (!used.has(v >>> 0)) free.push(intToIp(v));
  }
  return {
    networkId: id, cidr: row.cidr, limit: cap,
    used: [...used].sort((a, b) => a - b).map(intToIp),
    free, freeCount: free.length,
    truncated: free.length >= cap,
  };
}

// ------------------------------------------------------------------ links

function getLinkRow(id) {
  return db.prepare('SELECT * FROM links WHERE id = ?').get(id);
}

function listLinks() {
  return db.prepare('SELECT * FROM links ORDER BY created_at, rowid').all().map(linkToApi);
}

function validateLinkFields(f) {
  if (!f.fromNodeId) throw new ApiError(400, 'fromNodeId is required');
  if (!f.toNodeId) throw new ApiError(400, 'toNodeId is required');
  assertEnum(f.type, E.LINK_TYPES, 'type');
}

function resolveLinkFields(body, existing) {
  const base = existing || { from_node_id: null, to_node_id: null, type: 'custom', label: '' };
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  return {
    fromNodeId: has('fromNodeId') ? body.fromNodeId : base.from_node_id,
    toNodeId: has('toNodeId') ? body.toNodeId : base.to_node_id,
    type: has('type') ? body.type : base.type,
    label: has('label') ? body.label : base.label,
  };
}

const insLink = db.prepare(`
  INSERT INTO links (id, from_node_id, to_node_id, type, label, created_at, updated_at)
  VALUES (@id, @from_node_id, @to_node_id, @type, @label, @created_at, @updated_at)
`);

function createLink(body) {
  const f = resolveLinkFields(body, null);
  validateLinkFields(f);
  const id = body.id || uid('lk');
  const ts = now();
  try {
    insLink.run({ id, from_node_id: f.fromNodeId, to_node_id: f.toNodeId, type: f.type, label: f.label || '', created_at: ts, updated_at: ts });
  } catch (err) { throw mapDbError(err); }
  return linkToApi(getLinkRow(id));
}

const updLink = db.prepare(`
  UPDATE links SET from_node_id=@from_node_id, to_node_id=@to_node_id, type=@type, label=@label, updated_at=@updated_at WHERE id=@id
`);

function updateLink(id, body) {
  const existing = getLinkRow(id);
  if (!existing) throw new ApiError(404, 'Link not found');
  const f = resolveLinkFields(body, existing);
  validateLinkFields(f);
  try {
    updLink.run({ id, from_node_id: f.fromNodeId, to_node_id: f.toNodeId, type: f.type, label: f.label || '', updated_at: now() });
  } catch (err) { throw mapDbError(err); }
  return linkToApi(getLinkRow(id));
}

function deleteLink(id) {
  if (!getLinkRow(id)) throw new ApiError(404, 'Link not found');
  db.prepare('DELETE FROM links WHERE id = ?').run(id);
  return { id, deleted: true };
}

// ------------------------------------------------------------------ topology / export / import

function getTopology() {
  return { nodes: listNodes(), ports: allPorts(), networks: listNetworks(), links: listLinks() };
}

function allPorts() {
  return db.prepare('SELECT * FROM ports ORDER BY node_id, port_number').all().map(portToApi);
}

// Export = migration contract, identical shape to the prototype's JSON export.
function exportAll() {
  return { nodes: listNodes(), ports: allPorts(), networks: listNetworks(), links: listLinks() };
}

function isEmpty() {
  return db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c === 0;
}

// Replace-all import inside one transaction. Backfills defaults like the prototype's
// normalizeState/normalizePort. defer_foreign_keys lets us insert in any order.
function importAll(data) {
  if (!data || !Array.isArray(data.nodes)) throw new ApiError(400, 'import payload must include a nodes array');
  const nodes = data.nodes;
  const ports = Array.isArray(data.ports) ? data.ports : [];
  const networks = Array.isArray(data.networks) ? data.networks : [];
  const links = Array.isArray(data.links) ? data.links : [];
  const ts = now();

  const run = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    db.prepare('DELETE FROM node_tags').run();
    db.prepare('DELETE FROM tags').run();
    db.prepare('DELETE FROM links').run();
    db.prepare('DELETE FROM ports').run();
    db.prepare('DELETE FROM nodes').run();
    db.prepare('DELETE FROM networks').run();

    for (const nw of networks) {
      insNetwork.run({
        id: nw.id || uid('nw'), name: String(nw.name || '').trim(), cidr: nw.cidr || '',
        vlan_id: nw.vlanId === undefined || nw.vlanId === null || nw.vlanId === '' ? null : Number(nw.vlanId),
        color: nw.color || '', created_at: nw.createdAt || ts, updated_at: nw.updatedAt || ts,
      });
    }
    for (const n of nodes) {
      const id = n.id || uid('n');
      const iconType = E.ICON_TYPES.includes(n.iconType) ? n.iconType : '';
      const status = E.NODE_STATUS.includes(n.status) ? n.status : 'unknown';
      const type = E.NODE_TYPES.includes(n.type) ? n.type : 'physical';
      insNode.run({
        id, name: String(n.name || '').trim(), type, parent_id: n.parentId || null,
        ip_address: n.ipAddress || '', mac_address: n.macAddress || '', os: n.os || '',
        role: n.role || '', status, network_id: n.networkId || null, icon_type: iconType,
        icon_value: typeof n.iconValue === 'string' ? n.iconValue : '', notes: n.notes || '',
        pos_x: Number(n.posX) || 0, pos_y: Number(n.posY) || 0,
        last_seen: n.lastSeen || null,
        created_at: n.createdAt || ts, updated_at: n.updatedAt || ts,
      });
      setTagsForNode(id, Array.isArray(n.tags) ? n.tags : []);
    }
    for (const p of ports) {
      const f = normalizeImportedPort(p);
      insPort.run({
        id: p.id || uid('p'), node_id: p.nodeId, port_number: Number(p.portNumber),
        protocol: E.PORT_PROTOCOLS.includes(p.protocol) ? p.protocol : 'tcp',
        service_name: p.serviceName || '', description: p.description || '',
        status: E.PORT_STATUS.includes(p.status) ? p.status : 'in_use',
        domain: f.domain, exposure: f.exposure, scheme: f.scheme,
        host_port: f.hostPort, target_node_id: p.targetNodeId || null,
        last_seen: p.lastSeen || null,
        created_at: p.createdAt || ts, updated_at: p.updatedAt || ts,
      });
    }
    for (const l of links) {
      insLink.run({
        id: l.id || uid('lk'), from_node_id: l.fromNodeId, to_node_id: l.toNodeId,
        type: E.LINK_TYPES.includes(l.type) ? l.type : 'custom',
        label: typeof l.label === 'string' ? l.label : '',
        created_at: l.createdAt || ts, updated_at: l.updatedAt || ts,
      });
    }
  });

  try { run(); } catch (err) { throw mapDbError(err); }
  return exportAll();
}

// Mirror the prototype normalizePort backfill for legacy `exposed` exports.
function normalizeImportedPort(p) {
  let exposure = p.exposure;
  if (exposure === undefined) {
    if (p.exposed === true) exposure = p.domain ? 'public' : 'lan';
    else exposure = 'internal';
  }
  if (!E.PORT_EXPOSURE.includes(exposure)) exposure = 'internal';
  const domain = typeof p.domain === 'string' ? p.domain : '';
  if (domain && exposure !== 'public') exposure = 'public';
  let scheme = p.scheme;
  if (!E.PORT_SCHEME.includes(scheme)) {
    scheme = domain || Number(p.portNumber) === 443 || Number(p.portNumber) === 8443 ? 'https' : 'http';
    if (domain) scheme = 'https';
  }
  const hostPort = p.hostPort === undefined || p.hostPort === null || p.hostPort === '' ? null : Number(p.hostPort);
  return { exposure, domain, scheme, hostPort };
}

// ------------------------------------------------------------------ probe (health check)

// Collect probe targets = { node (api shape), ports (api shape) } per node.
// When nodeIds is provided, every id must exist (404 otherwise) so callers get a
// clear error; when null, probe every node.
function listProbeTargets({ nodeIds } = {}) {
  let rows;
  if (nodeIds && nodeIds.length) {
    rows = [];
    for (const id of nodeIds) {
      const row = getNodeRow(id);
      if (!row) throw new ApiError(404, `Node not found: ${id}`);
      rows.push(row);
    }
  } else if (nodeIds && nodeIds.length === 0) {
    rows = [];
  } else {
    rows = db.prepare('SELECT * FROM nodes ORDER BY created_at, rowid').all();
  }
  return rows.map((r) => ({
    node: nodeToApi(r, getTagsForNode(r.id)),
    ports: db.prepare('SELECT * FROM ports WHERE node_id = ? ORDER BY port_number, protocol').all(r.id).map(portToApi),
  }));
}

const updNodeProbe = db.prepare('UPDATE nodes SET status=?, last_seen=COALESCE(?, last_seen), updated_at=? WHERE id=?');
const updNodeProbeSeenOnly = db.prepare('UPDATE nodes SET last_seen=COALESCE(?, last_seen), updated_at=? WHERE id=?');
const updPortSeen = db.prepare('UPDATE ports SET last_seen=?, updated_at=? WHERE id=?');

// Persist a single node's probe outcome. Never touches port.status (in_use/
// reserved) — only sets last_seen on reachable ports and the node's status/
// last_seen. status 'unknown' leaves the node's stored status untouched (we
// couldn't actually determine it), only its last_seen is preserved via COALESCE.
function recordProbeResult({ nodeId, status, nodeLastSeen, openPortIds, portLastSeen }) {
  const ts = now();
  const run = db.transaction(() => {
    if (status === 'up' || status === 'down') {
      updNodeProbe.run(status, nodeLastSeen || null, ts, nodeId);
    } else {
      updNodeProbeSeenOnly.run(nodeLastSeen || null, ts, nodeId);
    }
    for (const pid of openPortIds || []) {
      updPortSeen.run(portLastSeen, ts, pid);
    }
  });
  run();
  const row = getNodeRow(nodeId);
  return { lastSeen: row ? row.last_seen ?? null : null };
}

// ------------------------------------------------------------------ import (parse → apply)

// Apply a parsed/edited import payload additively (does NOT replace-all like
// importAll). Everything happens in one transaction; de-dupes against existing
// data and returns what was created vs skipped.
//   payload = { nodes?, ports?, parentId?, networkId?, nodeId? }
//   - node.ref     : correlates a payload node to its payload ports (nodeRef)
//   - parentId     : default parent for created nodes lacking their own parentId
//   - networkId    : default network for created nodes lacking their own networkId
//   - nodeId       : default target node for ports lacking node association (ss)
// Node dedupe: existing match by name (case-insensitive) OR non-empty ipAddress.
// Port dedupe: existing (node_id, port_number, protocol) on the resolved node.
function importParsed(payload = {}) {
  const inNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const inPorts = Array.isArray(payload.ports) ? payload.ports : [];
  const defParent = payload.parentId || null;
  const defNetwork = payload.networkId || null;
  const defNodeId = payload.nodeId || null;

  if (defParent && !getNodeRow(defParent)) throw new ApiError(400, `parentId not found: ${defParent}`);
  if (defNetwork && !getNetworkRow(defNetwork)) throw new ApiError(400, `networkId not found: ${defNetwork}`);
  if (defNodeId && !getNodeRow(defNodeId)) throw new ApiError(400, `nodeId not found: ${defNodeId}`);

  const result = {
    nodes: { created: [], skipped: [] },
    ports: { created: [], skipped: [] },
  };

  // Preload existing nodes for dedupe.
  const existingNodes = db.prepare('SELECT id, name, ip_address FROM nodes').all();
  const byName = new Map();
  const byIp = new Map();
  for (const r of existingNodes) {
    byName.set(String(r.name).trim().toLowerCase(), r.id);
    if (r.ip_address) byIp.set(r.ip_address, r.id);
  }

  const refToId = new Map(); // payload ref → resolved node id (created or matched)
  const ts = now();

  const run = db.transaction(() => {
    // --- nodes ---
    for (const n of inNodes) {
      const ref = n.ref != null ? String(n.ref) : null;
      const name = String(n.name || '').trim();
      const ip = (n.ipAddress || '').trim();

      // Dedupe: existing by ip first (more specific), then by name.
      let matchId = null;
      if (ip && byIp.has(ip)) matchId = byIp.get(ip);
      else if (name && byName.has(name.toLowerCase())) matchId = byName.get(name.toLowerCase());

      if (matchId) {
        if (ref) refToId.set(ref, matchId);
        result.nodes.skipped.push({ ref, name, reason: 'already exists', nodeId: matchId });
        continue;
      }

      const body = {
        name,
        type: E.NODE_TYPES.includes(n.type) ? n.type : 'physical',
        parentId: n.parentId || defParent || null,
        ipAddress: ip,
        macAddress: n.macAddress || '',
        os: n.os || '',
        role: n.role || '',
        status: E.NODE_STATUS.includes(n.status) ? n.status : 'unknown',
        networkId: n.networkId || defNetwork || null,
        iconType: E.ICON_TYPES.includes(n.iconType) ? n.iconType : '',
        iconValue: typeof n.iconValue === 'string' ? n.iconValue : '',
        tags: Array.isArray(n.tags) ? n.tags : [],
        notes: n.notes || '',
      };
      const f = resolveNodeFields(body, null);
      try {
        validateNodeFields(f);
      } catch (err) {
        result.nodes.skipped.push({ ref, name, reason: err.message });
        continue;
      }
      const id = uid('n');
      try {
        insNode.run({
          id, name: String(f.name).trim(), type: f.type, parent_id: f.parentId || null,
          ip_address: f.ipAddress || '', mac_address: f.macAddress || '', os: f.os || '',
          role: f.role || '', status: f.status, network_id: f.networkId || null,
          icon_type: f.iconType || '', icon_value: f.iconValue || '', notes: f.notes || '',
          pos_x: 0, pos_y: 0, last_seen: null, created_at: ts, updated_at: ts,
        });
        setTagsForNode(id, f.tags || []);
      } catch (err) {
        result.nodes.skipped.push({ ref, name, reason: (mapDbError(err) || err).message });
        continue;
      }
      // Register for later dedupe within the same batch + ref resolution.
      if (ref) refToId.set(ref, id);
      if (name) byName.set(name.toLowerCase(), id);
      if (f.ipAddress) byIp.set(f.ipAddress, id);
      result.nodes.created.push({ id, name, ref });
    }

    // --- ports ---
    for (const p of inPorts) {
      // Resolve target node: explicit nodeId → payload ref → default nodeId.
      let targetNode = null;
      if (p.nodeId && getNodeRow(p.nodeId)) targetNode = p.nodeId;
      else if (p.nodeRef != null && refToId.has(String(p.nodeRef))) targetNode = refToId.get(String(p.nodeRef));
      else if (defNodeId) targetNode = defNodeId;

      const portNumber = Number(p.portNumber);
      if (!targetNode) {
        result.ports.skipped.push({ portNumber: p.portNumber, protocol: p.protocol, reason: 'no target node (set nodeId, nodeRef, or top-level nodeId)' });
        continue;
      }
      // Parsed ports carry no status; default to in_use. Only pass keys that are
      // actually present so resolvePortFields applies its own defaults otherwise.
      const portBody = {
        portNumber,
        protocol: E.PORT_PROTOCOLS.includes(p.protocol) ? p.protocol : 'tcp',
        status: E.PORT_STATUS.includes(p.status) ? p.status : 'in_use',
      };
      if (p.serviceName !== undefined) portBody.serviceName = p.serviceName;
      if (p.description !== undefined) portBody.description = p.description;
      if (p.domain !== undefined) portBody.domain = p.domain;
      if (p.exposure !== undefined) portBody.exposure = p.exposure;
      if (p.scheme !== undefined) portBody.scheme = p.scheme;
      if (p.hostPort !== undefined) portBody.hostPort = p.hostPort;
      if (p.targetNodeId !== undefined) portBody.targetNodeId = p.targetNodeId;
      const f = resolvePortFields(portBody, null);
      try {
        validatePortFields(f);
      } catch (err) {
        result.ports.skipped.push({ nodeId: targetNode, portNumber: p.portNumber, protocol: p.protocol, reason: err.message });
        continue;
      }
      // Dedupe against existing (node, port, protocol).
      const dup = db.prepare('SELECT id FROM ports WHERE node_id=? AND port_number=? AND protocol=?')
        .get(targetNode, Number(f.portNumber), f.protocol);
      if (dup) {
        result.ports.skipped.push({ nodeId: targetNode, portNumber: Number(f.portNumber), protocol: f.protocol, reason: 'already exists', portId: dup.id });
        continue;
      }
      const id = uid('p');
      try {
        insPort.run({
          id, node_id: targetNode, port_number: Number(f.portNumber), protocol: f.protocol,
          service_name: f.serviceName || '', description: f.description || '', status: f.status,
          domain: f.domain || '', exposure: f.exposure, scheme: f.scheme,
          host_port: f.hostPort === '' || f.hostPort === undefined ? null : (f.hostPort === null ? null : Number(f.hostPort)),
          target_node_id: f.targetNodeId || null, last_seen: null, created_at: ts, updated_at: ts,
        });
      } catch (err) {
        result.ports.skipped.push({ nodeId: targetNode, portNumber: Number(f.portNumber), protocol: f.protocol, reason: (mapDbError(err) || err).message });
        continue;
      }
      result.ports.created.push({ id, nodeId: targetNode, portNumber: Number(f.portNumber), protocol: f.protocol });
    }
  });

  try { run(); } catch (err) { throw mapDbError(err); }

  return {
    created: { nodes: result.nodes.created.length, ports: result.ports.created.length },
    skipped: { nodes: result.nodes.skipped.length, ports: result.ports.skipped.length },
    nodes: result.nodes,
    ports: result.ports,
  };
}

module.exports = {
  // nodes
  listNodes, getNode, createNode, updateNode, deleteNode,
  // ports
  listPortsForNode, createPort, updatePort, deletePort, freePorts,
  // networks
  listNetworks, createNetwork, updateNetwork, deleteNetwork, freeIps,
  // links
  listLinks, createLink, updateLink, deleteLink,
  // aggregate
  getTopology, exportAll, importAll, isEmpty,
  // probe (health check)
  listProbeTargets, recordProbeResult,
  // import (parse → apply)
  importParsed,
};
