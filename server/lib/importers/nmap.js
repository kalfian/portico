'use strict';

// Parse `nmap -oX -` XML into host nodes + open ports. Defensive regex-based
// parsing (no XML dep): the nmap XML schema is stable and controlled, and we
// never throw on malformed input — anything we can't read becomes a warning.
//
// Each <host> with an IPv4 <address> → node { type:'physical', ipAddress }.
// Each open <port> → port { portNumber, protocol, serviceName }.

const { inferScheme, toLines } = require('./common');

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

function parse(text) {
  const out = { nodes: [], ports: [], warnings: [] };
  const xml = String(text == null ? '' : text);
  if (!xml.trim()) {
    out.warnings.push('Empty input');
    return out;
  }
  if (!/<host\b/i.test(xml)) {
    out.warnings.push('No <host> elements found — is this nmap -oX output?');
    return out;
  }

  // Split into <host>...</host> blocks (tolerant of attributes on <host ...>).
  const hostBlocks = xml.match(/<host\b[\s\S]*?<\/host>/gi) || [];
  let seq = 0;
  for (const block of hostBlocks) {
    // IPv4 address only.
    let ip = '';
    const addrRe = /<address\b[^>]*>/gi;
    let a;
    while ((a = addrRe.exec(block)) != null) {
      if (/addrtype="ipv4"/i.test(a[0])) { ip = attr(a[0], 'addr'); break; }
    }
    const hostnameTag = (block.match(/<hostname\b[^>]*>/i) || [''])[0];
    const hostname = attr(hostnameTag, 'name');
    const stateTag = (block.match(/<status\b[^>]*>/i) || [''])[0];
    const hostState = attr(stateTag, 'state');

    if (!ip && !hostname) {
      out.warnings.push('Skipped a host with no IPv4 address or hostname');
      continue;
    }
    const ref = `nmap:${ip || hostname}:${seq++}`;
    out.nodes.push({
      ref,
      name: hostname || ip,
      type: 'physical',
      ipAddress: ip,
      status: hostState === 'up' ? 'up' : (hostState === 'down' ? 'down' : 'unknown'),
      notes: `nmap scan${hostname && ip ? ` (${hostname})` : ''}`,
    });

    // Open ports only.
    const portRe = /<port\b[^>]*>[\s\S]*?<\/port>/gi;
    let pm;
    const seen = new Set();
    while ((pm = portRe.exec(block)) != null) {
      const chunk = pm[0];
      const openTag = (chunk.match(/<port\b[^>]*>/i) || [''])[0];
      const protocol = (attr(openTag, 'protocol') || 'tcp').toLowerCase();
      const portid = Number(attr(openTag, 'portid'));
      const stTag = (chunk.match(/<state\b[^>]*>/i) || [''])[0];
      const st = attr(stTag, 'state');
      if (st && st !== 'open') continue; // only import open ports
      if (!Number.isInteger(portid) || portid < 1 || portid > 65535) continue;
      const svcTag = (chunk.match(/<service\b[^>]*>/i) || [''])[0];
      const service = attr(svcTag, 'name');
      const proto = protocol === 'udp' ? 'udp' : 'tcp';
      const key = `${portid}/${proto}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.ports.push({
        nodeRef: ref,
        portNumber: portid,
        protocol: proto,
        serviceName: service || '',
        exposure: 'lan', // observed over the network
        scheme: inferScheme(portid, service),
        description: `nmap: open ${portid}/${proto}${service ? ` (${service})` : ''}`,
      });
    }
  }

  if (!out.nodes.length) out.warnings.push('No hosts parsed from nmap XML');
  return out;
}

module.exports = { parse };
