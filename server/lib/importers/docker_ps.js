'use strict';

// Parse `docker ps` output into container nodes + published ports.
// Supports BOTH:
//   - default table output (`docker ps`)
//   - JSON-lines output    (`docker ps --format '{{json .}}'`)
//
// Each container → node { type:'container' }. Published port mappings
// `0.0.0.0:8080->80/tcp` → a port { portNumber: containerPort, hostPort, protocol }.
// exposure: 0.0.0.0 / :: (all interfaces) → 'public'; a specific host IP → 'lan';
// merely-exposed ports (no host binding, e.g. `80/tcp`) → 'internal', no hostPort.

const { inferScheme, toLines } = require('./common');

// One published/exposed mapping token, e.g.:
//   0.0.0.0:8080->80/tcp | [::]:8080->80/tcp | :::8080->80/tcp
//   192.168.1.5:5000->5000/tcp | 80/tcp (exposed only)
const MAP_RE = /(?:(\d{1,3}(?:\.\d{1,3}){3}|\[?[0-9a-f:]+\]?|\*):)?(\d+)(?:->(\d+))?\/(tcp|udp)/gi;

function statusToNode(status) {
  const s = String(status || '').toLowerCase();
  if (s.startsWith('up')) return 'up';
  if (s.startsWith('exited') || s.startsWith('dead') || s.startsWith('created')) return 'down';
  return 'unknown';
}

// Parse a ports string (from either format) into port objects for a container.
function parsePorts(portsStr, ref, warnings, containerName) {
  const ports = [];
  const seen = new Set();
  let m;
  MAP_RE.lastIndex = 0;
  while ((m = MAP_RE.exec(String(portsStr || ''))) != null) {
    const hostIp = m[1] || null;
    // With a host binding present: m[2]=hostPort, m[3]=containerPort.
    // Exposed-only (no `->`): m[2]=containerPort, m[3]=undefined.
    let hostPort = null;
    let containerPort;
    if (m[3] !== undefined) {
      hostPort = Number(m[2]);
      containerPort = Number(m[3]);
    } else {
      containerPort = Number(m[2]);
    }
    const protocol = m[4].toLowerCase();
    if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) continue;

    let exposure;
    if (hostPort == null) exposure = 'internal';
    else if (!hostIp || hostIp === '0.0.0.0' || hostIp === '*' || hostIp === '[::]' || hostIp === '::' || hostIp === ':') exposure = 'public';
    else exposure = 'lan';

    const key = `${containerPort}/${protocol}`;
    if (seen.has(key)) continue; // dedupe IPv4+IPv6 duplicate mappings of the same port
    seen.add(key);

    ports.push({
      nodeRef: ref,
      portNumber: containerPort,
      protocol,
      hostPort,
      exposure,
      scheme: inferScheme(containerPort),
      serviceName: '',
      description: hostPort != null ? `docker ${containerName}: host ${hostPort}→${containerPort}` : `docker ${containerName}: exposed ${containerPort}`,
    });
  }
  return ports;
}

function parseJsonLines(lines, out) {
  let seq = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch (_) { out.warnings.push(`Skipped unparseable JSON line: ${t.slice(0, 60)}`); continue; }
    const name = String(obj.Names || obj.Name || obj.names || '').split(',')[0].trim();
    if (!name) { out.warnings.push('Skipped a JSON entry with no container name'); continue; }
    const ref = `docker:${name}:${seq++}`;
    out.nodes.push({
      ref,
      name,
      type: 'container',
      status: statusToNode(obj.Status || obj.State),
      role: obj.Image ? `image:${obj.Image}` : '',
      notes: [obj.Image ? `image ${obj.Image}` : '', obj.Status ? `status ${obj.Status}` : ''].filter(Boolean).join('; '),
    });
    for (const p of parsePorts(obj.Ports || '', ref, out.warnings, name)) out.ports.push(p);
  }
}

function parseTable(lines, out) {
  let seq = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^CONTAINER\s+ID/i.test(line.trim())) continue; // header
    // The container name is the last whitespace-delimited token; the ports live
    // anywhere on the line (extracted by MAP_RE regardless of column position).
    const tokens = line.trim().split(/\s+/);
    const name = tokens[tokens.length - 1];
    if (!name) continue;
    const status = (line.match(/\b(Up|Exited|Created|Restarting|Paused|Dead)\b[^\t]*/i) || [''])[0];
    const ref = `docker:${name}:${seq++}`;
    out.nodes.push({
      ref,
      name,
      type: 'container',
      status: statusToNode(status),
      role: '',
      notes: status ? `status ${status.trim()}` : '',
    });
    for (const p of parsePorts(line, ref, out.warnings, name)) out.ports.push(p);
  }
}

function parse(text) {
  const out = { nodes: [], ports: [], warnings: [] };
  const lines = toLines(text).filter((l) => l.trim() !== '');
  if (!lines.length) {
    out.warnings.push('Empty input');
    return out;
  }
  // JSON-lines if the first non-blank line looks like a JSON object.
  const isJson = lines[0].trim().startsWith('{');
  if (isJson) parseJsonLines(lines, out);
  else parseTable(lines, out);

  if (!out.nodes.length) out.warnings.push('No containers found in input');
  return out;
}

module.exports = { parse };
