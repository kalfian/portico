'use strict';

// Dispatch a raw import parse to the right source parser. Each parser returns a
// dry-run preview { nodes, ports, warnings } mapped to our API shapes; no DB
// writes happen here.

const { ApiError } = require('../util');

const PARSERS = {
  docker_ps: require('./docker_ps'),
  ss: require('./ss'),
  proxmox: require('./proxmox'),
  nmap: require('./nmap'),
};

const SOURCES = Object.keys(PARSERS);

function parseSource(source, text) {
  const key = String(source || '').trim();
  const parser = PARSERS[key];
  if (!parser) {
    throw new ApiError(400, `Unknown import source "${source}". Supported: ${SOURCES.join(', ')}`);
  }
  if (typeof text !== 'string') {
    throw new ApiError(400, 'text must be a string containing the raw command output');
  }
  const out = parser.parse(text);
  return {
    source: key,
    nodes: out.nodes || [],
    ports: out.ports || [],
    warnings: out.warnings || [],
  };
}

module.exports = { parseSource, SOURCES };
