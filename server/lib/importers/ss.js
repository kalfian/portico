'use strict';

// Parse `ss -tlnp` / `ss -tulpn` listening sockets into ports for a SINGLE node
// (the user picks the target node at apply time via top-level `nodeId`, or by
// setting each port's nodeId/nodeRef). We can't know the host from ss output, so
// every port comes back with nodeRef:null and a warning.
//
// Extracts: port, protocol (tcp/udp), and process/service name from
// `users:(("sshd",pid=800,fd=3))` when present.
//
// exposure heuristic: bound to 0.0.0.0 / :: / * (all interfaces) → 'lan';
// bound to 127.0.0.1 / ::1 (loopback only) → 'internal'.

const { inferScheme, toLines } = require('./common');

// Extract the port from a "Local Address:Port" field. Handles:
//   0.0.0.0:22 | *:22 | 127.0.0.1:631 | [::]:22 | [::1]:631 | [2001:db8::1]:80
function addrPort(field) {
  const idx = field.lastIndexOf(':');
  if (idx < 0) return null;
  const host = field.slice(0, idx);
  const port = Number(field.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

function exposureFor(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (h === '127.0.0.1' || h === '::1' || h.startsWith('127.')) return 'internal';
  return 'lan'; // 0.0.0.0, ::, *, or a specific reachable interface IP
}

function serviceFromUsers(line) {
  const m = line.match(/users:\(\("([^"]+)"/);
  return m ? m[1] : '';
}

function parse(text) {
  const out = { nodes: [], ports: [], warnings: [] };
  const lines = toLines(text).filter((l) => l.trim() !== '');
  if (!lines.length) {
    out.warnings.push('Empty input');
    return out;
  }

  const seen = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(Netid|State)\b/i.test(line)) continue; // header
    const tokens = line.split(/\s+/);
    if (!tokens.length) continue;

    // Determine protocol + where the "Local Address:Port" column sits.
    // With Netid column (mixed tcp+udp, e.g. `ss -tulpn`): tokens[0] = tcp|udp,
    // tokens[1] = state, ... local addr at index 4.
    // Without Netid (e.g. `ss -tlnp`): tokens[0] = state (LISTEN/UNCONN),
    // local addr at index 3. State UNCONN implies udp, LISTEN implies tcp.
    let protocol;
    let localField;
    if (/^(tcp|udp)$/i.test(tokens[0])) {
      protocol = tokens[0].toLowerCase();
      localField = tokens[4];
    } else if (/^(LISTEN|UNCONN)$/i.test(tokens[0])) {
      protocol = /^UNCONN$/i.test(tokens[0]) ? 'udp' : 'tcp';
      localField = tokens[3];
    } else {
      out.warnings.push(`Skipped unrecognized line: ${line.slice(0, 60)}`);
      continue;
    }
    if (!localField) {
      out.warnings.push(`Skipped line with no local address: ${line.slice(0, 60)}`);
      continue;
    }
    const ap = addrPort(localField);
    if (!ap) {
      out.warnings.push(`Could not parse address:port from "${localField}"`);
      continue;
    }
    const key = `${ap.port}/${protocol}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const service = serviceFromUsers(line);
    out.ports.push({
      nodeRef: null, // target node chosen at apply time
      portNumber: ap.port,
      protocol,
      serviceName: service,
      exposure: exposureFor(ap.host),
      scheme: inferScheme(ap.port, service),
      description: `ss: listening on ${localField}${service ? ` (${service})` : ''}`,
    });
  }

  if (!out.ports.length) out.warnings.push('No listening sockets found in input');
  else out.warnings.push('ss ports have no node — set a target node at apply time (top-level nodeId, or per-port nodeId/nodeRef)');
  return out;
}

module.exports = { parse };
