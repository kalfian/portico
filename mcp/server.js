#!/usr/bin/env node
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const packageJson = require('../package.json');
const schemas = require('./schemas');
const { clientFromEnv, PorticoClientError } = require('./portico-client');

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const UPDATE_ANNOTATIONS = { ...WRITE_ANNOTATIONS, destructiveHint: true, idempotentHint: true };
const DELETE_ANNOTATIONS = { ...UPDATE_ANNOTATIONS };

function result(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResult(error) {
  const known = error instanceof PorticoClientError;
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: {
          code: known ? error.code : 'mcp_internal_error',
          message: known ? error.message : 'The Portico MCP tool failed',
          ...(known && error.status ? { status: error.status } : {}),
        },
      }),
    }],
  };
}

function requireUpdateFields(fields) {
  if (Object.keys(fields).length === 0) {
    throw new PorticoClientError('At least one field to update is required', { code: 'invalid_input' });
  }
  return fields;
}

function register(server, client, name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return result(await handler(args));
    } catch (error) {
      return errorResult(error);
    }
  });
}

function createServer({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const client = clientFromEnv(env, { fetchImpl });
  const server = new McpServer({ name: 'portico', version: packageJson.version }, {
    instructions:
      'Read tools use Portico public GET endpoints. Write tools require PORTICO_TOKEN with read_write scope. ' +
      'Treat source/observedAt/lastSeen as provenance or observations, not proof that sample or manual records are live.',
  });

  register(server, client, 'portico_read_context', {
    description: 'Read Portico\'s bounded one-call LLM summary and structured topology context.',
    inputSchema: schemas.empty,
    annotations: READ_ANNOTATIONS,
  }, () => client.request('GET', '/api/llm/context'));

  register(server, client, 'portico_read_topology', {
    description: 'Read nodes, ports, networks, links, Cloudflare route metadata, and computed topology edges.',
    inputSchema: schemas.empty,
    annotations: READ_ANNOTATIONS,
  }, () => client.request('GET', '/api/topology'));

  register(server, client, 'portico_read_inventory', {
    description: 'Read the server-to-owner-to-port-to-target inventory projection with explicit Cloudflare associations.',
    inputSchema: schemas.empty,
    annotations: READ_ANNOTATIONS,
  }, () => client.request('GET', '/api/inventory'));

  register(server, client, 'portico_read_node', {
    description: 'Read one node by ID and, by default, its owned ports.',
    inputSchema: schemas.readNode,
    annotations: READ_ANNOTATIONS,
  }, async ({ nodeId, includePorts }) => {
    const node = await client.request('GET', `/api/nodes/${encodeURIComponent(nodeId)}`);
    if (!includePorts) return { node };
    const ports = await client.request('GET', `/api/nodes/${encodeURIComponent(nodeId)}/ports`);
    return { node, ports };
  });

  register(server, client, 'portico_read_networks', {
    description: 'List Portico network and VLAN records.',
    inputSchema: schemas.empty,
    annotations: READ_ANNOTATIONS,
  }, () => client.request('GET', '/api/networks'));

  register(server, client, 'portico_read_links', {
    description: 'List explicit typed links between nodes.',
    inputSchema: schemas.empty,
    annotations: READ_ANNOTATIONS,
  }, () => client.request('GET', '/api/links'));

  register(server, client, 'portico_read_cloudflare_routes', {
    description: 'List Cloudflare route metadata stored in Portico. This never calls or mutates Cloudflare.',
    inputSchema: schemas.empty,
    annotations: READ_ANNOTATIONS,
  }, () => client.request('GET', '/api/cloudflare-routes'));

  register(server, client, 'portico_find_free_ports', {
    description: 'Find unrecorded TCP or UDP ports on one node within a range of at most 1001 values.',
    inputSchema: schemas.freePorts,
    annotations: READ_ANNOTATIONS,
  }, ({ nodeId, from, to, protocol }) => {
    if (to < from) throw new PorticoClientError('to must be greater than or equal to from', { code: 'invalid_input' });
    if (to - from > 1000) throw new PorticoClientError('Port ranges are limited to 1001 values', { code: 'invalid_input' });
    return client.request(
      'GET', `/api/nodes/${encodeURIComponent(nodeId)}/free-ports?from=${from}&to=${to}&protocol=${protocol}`
    );
  });

  register(server, client, 'portico_find_free_ips', {
    description: 'Find up to 256 unassigned host addresses in a recorded network CIDR.',
    inputSchema: schemas.freeIps,
    annotations: READ_ANNOTATIONS,
  }, ({ networkId, limit }) => client.request(
    'GET',
    `/api/networks/${encodeURIComponent(networkId)}/free-ips?limit=${limit}`
  ));

  register(server, client, 'portico_write_create_node', {
    description: 'Create a Portico inventory node. Requires a read_write token.',
    inputSchema: schemas.createNode,
    annotations: WRITE_ANNOTATIONS,
  }, (args) => client.request('POST', '/api/nodes', args));

  register(server, client, 'portico_write_update_node', {
    description: 'Update allowed inventory fields on one node. Requires a read_write token.',
    inputSchema: schemas.updateNode,
    annotations: UPDATE_ANNOTATIONS,
  }, ({ nodeId, ...fields }) => client.request(
    'PUT', `/api/nodes/${encodeURIComponent(nodeId)}`, requireUpdateFields(fields)
  ));

  register(server, client, 'portico_write_delete_node', {
    description: 'Delete one node after explicit confirmation. Ports and links cascade; children reparent to its parent.',
    inputSchema: schemas.deleteNode,
    annotations: DELETE_ANNOTATIONS,
  }, ({ nodeId }) => client.request('DELETE', `/api/nodes/${encodeURIComponent(nodeId)}`));

  register(server, client, 'portico_write_create_port', {
    description: 'Create a port record owned by a node. Use the dedicated route tool to associate Cloudflare metadata.',
    inputSchema: schemas.createPort,
    annotations: WRITE_ANNOTATIONS,
  }, ({ nodeId, ...fields }) => client.request('POST', `/api/nodes/${encodeURIComponent(nodeId)}/ports`, fields));

  register(server, client, 'portico_write_update_port', {
    description: 'Update a port record without changing its Cloudflare route association.',
    inputSchema: schemas.updatePort,
    annotations: UPDATE_ANNOTATIONS,
  }, ({ portId, ...fields }) => client.request(
    'PUT', `/api/ports/${encodeURIComponent(portId)}`, requireUpdateFields(fields)
  ));

  register(server, client, 'portico_write_delete_port', {
    description: 'Delete one port record after explicit confirmation.',
    inputSchema: schemas.deletePort,
    annotations: DELETE_ANNOTATIONS,
  }, ({ portId }) => client.request('DELETE', `/api/ports/${encodeURIComponent(portId)}`));

  register(server, client, 'portico_write_set_cloudflare_route', {
    description: 'Associate an existing Portico Cloudflare route record with a port. No Cloudflare API is called.',
    inputSchema: schemas.setCloudflareRoute,
    annotations: UPDATE_ANNOTATIONS,
  }, ({ portId, cloudflareRouteId }) => client.request('PUT', `/api/ports/${encodeURIComponent(portId)}`, {
    exposureMode: 'cloudflare',
    cloudflareRouteId,
  }));

  register(server, client, 'portico_write_clear_cloudflare_route', {
    description: 'Remove a port-to-route association after confirmation and return the port to LAN mode.',
    inputSchema: schemas.clearCloudflareRoute,
    annotations: DELETE_ANNOTATIONS,
  }, ({ portId }) => client.request('PUT', `/api/ports/${encodeURIComponent(portId)}`, {
    exposureMode: 'lan',
    cloudflareRouteId: null,
  }));

  register(server, client, 'portico_write_create_network', {
    description: 'Create a network or VLAN record.',
    inputSchema: schemas.createNetwork,
    annotations: WRITE_ANNOTATIONS,
  }, (args) => client.request('POST', '/api/networks', args));

  register(server, client, 'portico_write_update_network', {
    description: 'Update a network or VLAN record.',
    inputSchema: schemas.updateNetwork,
    annotations: UPDATE_ANNOTATIONS,
  }, ({ networkId, ...fields }) => client.request(
    'PUT', `/api/networks/${encodeURIComponent(networkId)}`, requireUpdateFields(fields)
  ));

  register(server, client, 'portico_write_delete_network', {
    description: 'Delete a network after explicit confirmation. Referencing nodes keep their records and lose networkId.',
    inputSchema: schemas.deleteNetwork,
    annotations: DELETE_ANNOTATIONS,
  }, ({ networkId }) => client.request('DELETE', `/api/networks/${encodeURIComponent(networkId)}`));

  register(server, client, 'portico_write_create_link', {
    description: 'Create an explicit typed link between two existing nodes.',
    inputSchema: schemas.createLink,
    annotations: WRITE_ANNOTATIONS,
  }, (args) => client.request('POST', '/api/links', args));

  register(server, client, 'portico_write_update_link', {
    description: 'Update an explicit typed link.',
    inputSchema: schemas.updateLink,
    annotations: UPDATE_ANNOTATIONS,
  }, ({ linkId, ...fields }) => client.request(
    'PUT', `/api/links/${encodeURIComponent(linkId)}`, requireUpdateFields(fields)
  ));

  register(server, client, 'portico_write_delete_link', {
    description: 'Delete an explicit typed link after confirmation.',
    inputSchema: schemas.deleteLink,
    annotations: DELETE_ANNOTATIONS,
  }, ({ linkId }) => client.request('DELETE', `/api/links/${encodeURIComponent(linkId)}`));

  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof PorticoClientError ? error.message : 'Unable to start Portico MCP server';
    process.stderr.write(`[portico-mcp] ${message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { createServer, errorResult, result };
