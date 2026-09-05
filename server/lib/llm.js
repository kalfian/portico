'use strict';

// Builds a compact, LLM-digestible view of the whole homelab: a markdown summary
// (hierarchy, IPs, notable ports + exposure, networks/VLANs, dependency links)
// plus the raw data for precise follow-up reasoning.

const store = require('../store');

function buildLlmContext() {
  const { nodes, ports, networks, links } = store.exportAll();

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const netById = new Map(networks.map((w) => [w.id, w]));
  const portsByNode = new Map();
  for (const p of ports) {
    if (!portsByNode.has(p.nodeId)) portsByNode.set(p.nodeId, []);
    portsByNode.get(p.nodeId).push(p);
  }
  const childrenOf = new Map();
  for (const n of nodes) {
    const key = n.parentId || '__root__';
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(n);
  }

  const lines = [];
  lines.push('# Home Server Topology');
  lines.push('');
  lines.push(`${nodes.length} nodes, ${ports.length} ports, ${networks.length} networks, ${links.length} dependency links.`);
  lines.push('');

  // Networks
  if (networks.length) {
    lines.push('## Networks');
    for (const w of networks) {
      const vlan = w.vlanId != null ? `, VLAN ${w.vlanId}` : '';
      lines.push(`- **${w.name}** — ${w.cidr || 'no CIDR'}${vlan}`);
    }
    lines.push('');
  }

  // Hierarchy
  lines.push('## Topology (hosts → guests)');
  const roots = (childrenOf.get('__root__') || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  const renderNode = (n, depth) => {
    const indent = '  '.repeat(depth);
    const net = n.networkId && netById.has(n.networkId) ? netById.get(n.networkId).name : null;
    const bits = [n.type, n.ipAddress || 'no-ip', `status:${n.status}`];
    if (net) bits.push(`net:${net}`);
    if (n.lastSeen) bits.push(`seen:${n.lastSeen}`);
    lines.push(`${indent}- **${n.name}** (${bits.join(', ')})`);

    const np = (portsByNode.get(n.id) || []).slice().sort((a, b) => a.portNumber - b.portNumber);
    const notable = np.filter((p) => p.exposure === 'public' || p.exposure === 'lan' || p.status === 'in_use');
    if (notable.length) {
      const desc = notable.map((p) => {
        let s = `${p.portNumber}/${p.protocol}`;
        if (p.serviceName) s += ` ${p.serviceName}`;
        if (p.exposure === 'public') s += ` [PUBLIC${p.domain ? ' ' + p.domain : ''}]`;
        else if (p.exposure === 'lan') s += ' [lan]';
        if (p.status === 'reserved') s += ' (reserved)';
        if (p.hostPort != null) {
          const tgt = p.targetNodeId && nodeById.has(p.targetNodeId) ? nodeById.get(p.targetNodeId).name : p.targetNodeId;
          s += ` →host:${p.hostPort}${tgt ? '→' + tgt : ''}`;
        }
        return s;
      });
      lines.push(`${indent}  ports: ${desc.join(', ')}`);
    }

    const kids = (childrenOf.get(n.id) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const k of kids) renderNode(k, depth + 1);
  };

  for (const r of roots) renderNode(r, 0);
  lines.push('');

  // Dependency links
  if (links.length) {
    lines.push('## Dependency links (non-containment)');
    for (const l of links) {
      const from = nodeById.get(l.fromNodeId);
      const to = nodeById.get(l.toNodeId);
      const label = l.label ? ` (${l.label})` : '';
      lines.push(`- ${from ? from.name : l.fromNodeId} —${l.type}→ ${to ? to.name : l.toNodeId}${label}`);
    }
    lines.push('');
  }

  return { summary: lines.join('\n'), data: { nodes, ports, networks, links } };
}

module.exports = { buildLlmContext };
