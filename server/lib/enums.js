'use strict';

// Enum vocabularies — single source of truth for server-side validation.
// Mirrors the prototype's client-side guards.

const NODE_TYPES = ['physical', 'proxmox_host', 'vm', 'lxc', 'docker_host', 'container', 'network_device', 'iot'];
const NODE_STATUS = ['up', 'down', 'unknown'];
const ICON_TYPES = ['', 'selfhst', 'builtin', 'url', 'upload'];

const PORT_PROTOCOLS = ['tcp', 'udp'];
const PORT_STATUS = ['in_use', 'reserved'];
const PORT_EXPOSURE = ['internal', 'lan', 'public'];
const PORT_SCHEME = ['http', 'https'];

const LINK_TYPES = ['proxy', 'mount', 'dns', 'custom'];

module.exports = {
  NODE_TYPES,
  NODE_STATUS,
  ICON_TYPES,
  PORT_PROTOCOLS,
  PORT_STATUS,
  PORT_EXPOSURE,
  PORT_SCHEME,
  LINK_TYPES,
};
