'use strict';

// Parse Proxmox `qm list` (VMs) and `pct list` (LXC containers) output into nodes.
// Both share a leading integer VMID column but differ in column order:
//   qm  list:  VMID  NAME       STATUS   MEM(MB)  BOOTDISK(GB)  PID
//   pct list:  VMID  Status     Lock     Name
//
// Detection is per-line: if the token right after the VMID is a status keyword we
// treat it as a pct/LXC row (name = last token); otherwise a qm/VM row
// (name = token after VMID). vmid is recorded in role + notes.

const { toLines } = require('./common');

const STATUS_WORDS = new Set(['running', 'stopped', 'paused', 'suspended', 'unknown', 'prelaunch', 'internal-error']);

function statusToNode(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running') return 'up';
  if (s === 'stopped' || s === 'paused' || s === 'suspended') return 'down';
  return 'unknown';
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
    if (/^VMID\b/i.test(line)) continue; // header
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    const vmid = tokens[0];
    if (!/^\d+$/.test(vmid)) {
      out.warnings.push(`Skipped line without a numeric VMID: ${line.slice(0, 60)}`);
      continue;
    }

    let name;
    let status;
    let type;
    if (STATUS_WORDS.has(String(tokens[1]).toLowerCase())) {
      // pct/LXC form: VMID STATUS [LOCK] NAME → name is the last token.
      type = 'lxc';
      status = tokens[1];
      name = tokens[tokens.length - 1];
      // If the last token is itself a status word, there was no name.
      if (STATUS_WORDS.has(String(name).toLowerCase())) name = '';
    } else {
      // qm/VM form: VMID NAME STATUS ...
      type = 'vm';
      name = tokens[1];
      status = tokens.slice(2).find((t) => STATUS_WORDS.has(t.toLowerCase())) || '';
    }
    if (!name) {
      out.warnings.push(`VMID ${vmid}: no name found, using vmid as name`);
      name = `vm-${vmid}`;
    }
    if (seen.has(vmid)) continue;
    seen.add(vmid);

    out.nodes.push({
      ref: `pve:${type}:${vmid}`,
      name,
      type,
      status: statusToNode(status),
      role: `vmid:${vmid}`,
      notes: `Proxmox ${type === 'lxc' ? 'LXC' : 'VM'} vmid ${vmid}${status ? `, status ${status}` : ''}`,
    });
  }

  if (!out.nodes.length) out.warnings.push('No VMs/containers found in input');
  return out;
}

module.exports = { parse };
