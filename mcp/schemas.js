'use strict';

const { z } = require('zod');

const NODE_TYPES = ['physical', 'proxmox_host', 'vm', 'lxc', 'docker_host', 'container', 'network_device', 'iot'];
const NODE_STATUS = ['up', 'down', 'unknown'];
const PORT_PROTOCOLS = ['tcp', 'udp'];
const PORT_STATUS = ['in_use', 'reserved', 'active', 'up', 'inactive', 'down'];
const PORT_EXPOSURE = ['internal', 'lan', 'public'];
const LINK_TYPES = ['network', 'virtualization', 'proxy', 'mount', 'dns', 'custom'];

const id = z.string().trim().min(1).max(128);
const nullableId = z.union([id, z.null()]);
const shortText = z.string().max(256);
const longText = z.string().max(4000);
const ipv4OrEmpty = z.string().max(15).refine((value) => {
  if (value === '') return true;
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}, 'Must be an IPv4 address or an empty string');

const nodeFields = {
  name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(NODE_TYPES).optional(),
  parentId: nullableId.optional(),
  ipAddress: ipv4OrEmpty.optional(),
  macAddress: z.string().max(64).optional(),
  os: shortText.optional(),
  role: shortText.optional(),
  status: z.enum(NODE_STATUS).optional(),
  networkId: nullableId.optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  notes: longText.optional(),
};

const portFields = {
  portNumber: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(PORT_PROTOCOLS).optional(),
  serviceName: shortText.optional(),
  description: longText.optional(),
  status: z.enum(PORT_STATUS).optional(),
  domain: z.string().max(253).optional(),
  exposure: z.enum(PORT_EXPOSURE).optional(),
  exposureMode: z.enum(['lan', 'cloudflare']).optional(),
  scheme: z.enum(['http', 'https']).optional(),
  hostPort: z.union([z.number().int().min(1).max(65535), z.null()]).optional(),
  targetNodeId: nullableId.optional(),
};

const networkFields = {
  name: z.string().trim().min(1).max(200).optional(),
  cidr: z.string().max(64).optional(),
  vlanId: z.union([z.number().int().min(0).max(4094), z.null()]).optional(),
  color: z.string().max(64).optional(),
};

const linkFields = {
  fromNodeId: id.optional(),
  toNodeId: id.optional(),
  type: z.enum(LINK_TYPES).optional(),
  label: shortText.optional(),
};

module.exports = {
  empty: z.object({}).strict(),
  readNode: z.object({ nodeId: id, includePorts: z.boolean().default(true) }).strict(),
  freePorts: z.object({
    nodeId: id,
    from: z.number().int().min(1).max(65535).default(8000),
    to: z.number().int().min(1).max(65535).default(9000),
    protocol: z.enum(PORT_PROTOCOLS).default('tcp'),
  }).strict(),
  freeIps: z.object({ networkId: id, limit: z.number().int().min(1).max(256).default(64) }).strict(),
  createNode: z.object({ ...nodeFields, name: z.string().trim().min(1).max(200) }).strict(),
  updateNode: z.object({ nodeId: id, ...nodeFields }).strict(),
  deleteNode: z.object({ nodeId: id, confirm: z.literal(true) }).strict(),
  createPort: z.object({ nodeId: id, ...portFields, portNumber: z.number().int().min(1).max(65535) }).strict(),
  updatePort: z.object({ portId: id, ...portFields }).strict(),
  deletePort: z.object({ portId: id, confirm: z.literal(true) }).strict(),
  setCloudflareRoute: z.object({ portId: id, cloudflareRouteId: id }).strict(),
  clearCloudflareRoute: z.object({ portId: id, confirm: z.literal(true) }).strict(),
  createNetwork: z.object({ ...networkFields, name: z.string().trim().min(1).max(200) }).strict(),
  updateNetwork: z.object({ networkId: id, ...networkFields }).strict(),
  deleteNetwork: z.object({ networkId: id, confirm: z.literal(true) }).strict(),
  createLink: z.object({
    ...linkFields,
    fromNodeId: id,
    toNodeId: id,
    type: z.enum(LINK_TYPES),
  }).strict(),
  updateLink: z.object({ linkId: id, ...linkFields }).strict(),
  deleteLink: z.object({ linkId: id, confirm: z.literal(true) }).strict(),
};
