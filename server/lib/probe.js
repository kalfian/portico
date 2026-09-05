'use strict';

// Active health check. Given nodes + their ports, do a short TCP connect to
// `node.ipAddress : port.portNumber` to decide reachability, optionally refined
// by an HTTP(S) HEAD/GET for http/https-scheme ports. IPv4 only. Concurrency is
// capped so a probe never floods the network, and the whole run is bounded by a
// hard time budget.
//
// This module is pure orchestration/networking: it reads targets and writes
// results through `store` (the only place that touches SQLite). It NEVER
// overwrites a user's port.status (in_use/reserved). It only sets:
//   - port.last_seen  ← when that port's TCP connect succeeds
//   - node.last_seen  ← when the node is reachable (any port open)
//   - node.status     ← 'up' | 'down' | 'unknown' from reachability

const net = require('net');
const http = require('http');
const https = require('https');
const store = require('../store');
const { now, ApiError } = require('./util');

const DEFAULT_TIMEOUT_MS = 1500;
const MIN_TIMEOUT_MS = 200;
const MAX_TIMEOUT_MS = 10000;
const DEFAULT_CONCURRENCY = 10;
const MAX_CONCURRENCY = 20;
const MAX_NODES = 200; // per-request cap on how many nodes we'll probe
const MAX_PORTS = 2000; // per-request cap on total TCP connects
const HARD_BUDGET_MS = 60000; // overall wall-clock budget for one probe run

// Single TCP connect → resolves true if the socket opens within `timeout`.
function tcpConnect(host, port, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    try {
      socket.connect({ host, port, family: 4 }); // IPv4 only
    } catch (_) {
      done(false);
    }
  });
}

// Optional HTTP(S) refine for http/https-scheme ports: a successful response
// (any status code) confirms an app is actually listening, not just an open
// socket. Never throws; a failure just leaves the TCP result as-is.
function httpProbe(host, port, scheme, timeout) {
  return new Promise((resolve) => {
    const mod = scheme === 'https' ? https : http;
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let req;
    try {
      req = mod.request(
        {
          host,
          port,
          method: 'HEAD',
          path: '/',
          family: 4,
          timeout,
          rejectUnauthorized: false, // homelab self-signed certs are fine
        },
        (res) => {
          res.resume();
          done(true);
        }
      );
    } catch (_) {
      return done(false);
    }
    req.on('timeout', () => { req.destroy(); done(false); });
    req.on('error', () => done(false));
    req.end();
  });
}

// Run async tasks with a bounded concurrency + an overall deadline. Tasks that
// haven't started when the deadline passes resolve to their `onExpire` value.
async function runPool(items, worker, concurrency, deadline) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (Date.now() > deadline) {
        results[i] = await worker(items[i], true); // expired
        continue;
      }
      results[i] = await worker(items[i], false);
    }
  }
  const lanes = [];
  for (let k = 0; k < Math.min(concurrency, items.length); k++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}

function clampInt(v, def, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

// Orchestrate a probe run.
//   opts = { nodeIds?: string[], timeout?: ms, concurrency?: n, single?: bool }
// When `single` is true a missing / empty-address node is a hard error (used by
// the per-node endpoint); the bulk endpoint is lenient and just marks unknown.
async function runProbe(opts = {}) {
  const timeout = clampInt(opts.timeout, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const concurrency = clampInt(opts.concurrency, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY);

  let nodeIds = null;
  if (opts.nodeIds !== undefined && opts.nodeIds !== null) {
    if (!Array.isArray(opts.nodeIds)) throw new ApiError(400, 'nodeIds must be an array of node ids');
    nodeIds = opts.nodeIds.map((x) => String(x));
  }

  // store.listProbeTargets validates ids (throws 404 for a requested-but-missing id).
  const targets = store.listProbeTargets({ nodeIds });
  if (targets.length > MAX_NODES) {
    throw new ApiError(400, `Too many nodes to probe in one request (${targets.length} > ${MAX_NODES})`);
  }
  const totalPorts = targets.reduce((s, t) => s + t.ports.length, 0);
  if (totalPorts > MAX_PORTS) {
    throw new ApiError(400, `Too many ports to probe in one request (${totalPorts} > ${MAX_PORTS})`);
  }

  const deadline = Date.now() + HARD_BUDGET_MS;

  // Flatten to one work item per (node, probeable port). Ports with no usable
  // target (node has no IPv4 address) are recorded as skipped, not connected.
  const work = [];
  const perNode = new Map(); // nodeId → { node, portResults:[], probeable:0, open:0, skipped:0 }
  for (const t of targets) {
    const state = { node: t.node, portResults: [], probeable: 0, open: 0, skipped: 0 };
    perNode.set(t.node.id, state);
    const host = (t.node.ipAddress || '').trim();
    for (const p of t.ports) {
      if (!host) {
        state.skipped++;
        state.portResults.push({ portId: p.id, portNumber: p.portNumber, protocol: p.protocol, open: false, skipped: true, reason: 'node has no IPv4 address' });
        continue;
      }
      if (p.protocol !== 'tcp') {
        // UDP is not connection-oriented — a TCP connect is meaningless.
        state.skipped++;
        state.portResults.push({ portId: p.id, portNumber: p.portNumber, protocol: p.protocol, open: false, skipped: true, reason: 'udp not probeable via tcp connect' });
        continue;
      }
      state.probeable++;
      work.push({ nodeId: t.node.id, host, port: p });
    }
  }

  await runPool(
    work,
    async (item, expired) => {
      const state = perNode.get(item.nodeId);
      const p = item.port;
      if (expired) {
        state.skipped++;
        state.portResults.push({ portId: p.id, portNumber: p.portNumber, protocol: p.protocol, open: false, skipped: true, reason: 'time budget exceeded' });
        return;
      }
      let open = await tcpConnect(item.host, p.portNumber, timeout);
      let refined = false;
      if (open && (p.scheme === 'http' || p.scheme === 'https')) {
        // Refine only to promote confidence; a failed HTTP check does not flip
        // an already-open TCP socket to down.
        refined = await httpProbe(item.host, p.portNumber, p.scheme, timeout);
      }
      if (open) state.open++;
      state.portResults.push({ portId: p.id, portNumber: p.portNumber, protocol: p.protocol, open, httpOk: refined });
    },
    concurrency,
    deadline
  );

  // Decide node status + persist. up = any port open; down = had probeable ports
  // but none open; unknown = nothing probeable (no address / no tcp ports).
  const ts = now();
  const results = [];
  let up = 0;
  let down = 0;
  let unknown = 0;
  for (const state of perNode.values()) {
    let status;
    if (state.probeable === 0) status = 'unknown';
    else if (state.open > 0) status = 'up';
    else status = 'down';

    const nodeLastSeen = status === 'up' ? ts : null;
    const openPortIds = state.portResults.filter((r) => r.open).map((r) => r.portId);

    const saved = store.recordProbeResult({
      nodeId: state.node.id,
      status,
      nodeLastSeen, // null → node.last_seen is left untouched
      openPortIds,
      portLastSeen: ts,
    });

    if (status === 'up') up++;
    else if (status === 'down') down++;
    else unknown++;

    results.push({
      nodeId: state.node.id,
      name: state.node.name,
      ipAddress: state.node.ipAddress,
      status,
      lastSeen: saved.lastSeen,
      probeablePorts: state.probeable,
      openPorts: state.open,
      ports: state.portResults.map((r) => ({
        portId: r.portId,
        portNumber: r.portNumber,
        protocol: r.protocol,
        open: r.open,
        ...(r.httpOk ? { httpOk: true } : {}),
        ...(r.skipped ? { skipped: true, reason: r.reason } : {}),
        lastSeen: r.open ? ts : null,
      })),
    });
  }

  return { probed: results.length, up, down, unknown, timeoutMs: timeout, concurrency, results };
}

module.exports = { runProbe, tcpConnect, httpProbe };
