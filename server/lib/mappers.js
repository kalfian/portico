'use strict';

// The one place that translates between snake_case DB rows and camelCase JSON.
// `tags` is joined in separately (node_tags) — callers pass the tag name array.

function nodeToApi(row, tags = []) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    parentId: row.parent_id,
    ipAddress: row.ip_address,
    macAddress: row.mac_address,
    os: row.os,
    role: row.role,
    status: row.status,
    networkId: row.network_id,
    iconType: row.icon_type,
    iconValue: row.icon_value,
    tags,
    notes: row.notes,
    posX: row.pos_x,
    posY: row.pos_y,
    lastSeen: row.last_seen ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function portToApi(row) {
  return {
    id: row.id,
    nodeId: row.node_id,
    portNumber: row.port_number,
    protocol: row.protocol,
    serviceName: row.service_name,
    description: row.description,
    status: row.status,
    domain: row.domain,
    exposure: row.exposure,
    scheme: row.scheme,
    hostPort: row.host_port,
    targetNodeId: row.target_node_id,
    lastSeen: row.last_seen ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function networkToApi(row) {
  return {
    id: row.id,
    name: row.name,
    cidr: row.cidr,
    vlanId: row.vlan_id,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function linkToApi(row) {
  return {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    type: row.type,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { nodeToApi, portToApi, networkToApi, linkToApi };
