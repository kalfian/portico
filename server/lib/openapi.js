'use strict';

// Hand-written OpenAPI 3.0 spec. Served at GET /api/openapi.json so an LLM/tool can
// discover and call the API. Kept in one object; schemas are pragmatic, not exhaustive.

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example: { error: { code: 'not_found', message: 'Node not found' } },
    },
  },
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Home Server Topology & Port Manager API',
    version: '0.1.0',
    description:
      'Map home-server topology (parent→child containment + typed links) and inventory ports per node. ' +
      'Reads are public. Mutations require either a logged-in session cookie or a `read_write` bearer token. ' +
      'A `read` bearer token may only perform reads. Token management and change-password require a session.',
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'auth' }, { name: 'tokens' }, { name: 'nodes' }, { name: 'ports' },
    { name: 'networks' }, { name: 'links' }, { name: 'data' }, { name: 'llm' },
    { name: 'probe' }, { name: 'import' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'hst.sid', description: 'Interactive session cookie from /api/auth/login.' },
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'API token: `Authorization: Bearer hst_...`. Scope read or read_write.' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'validation_error' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
      },
      Node: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['physical', 'proxmox_host', 'vm', 'lxc', 'docker_host', 'container', 'network_device', 'iot'] },
          parentId: { type: 'string', nullable: true },
          ipAddress: { type: 'string' },
          macAddress: { type: 'string' },
          os: { type: 'string' },
          role: { type: 'string' },
          status: { type: 'string', enum: ['up', 'down', 'unknown'] },
          networkId: { type: 'string', nullable: true },
          iconType: { type: 'string', enum: ['', 'selfhst', 'builtin', 'url', 'upload'] },
          iconValue: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          posX: { type: 'number' },
          posY: { type: 'number' },
          lastSeen: { type: 'string', nullable: true, description: 'ISO-8601 UTC time the node was last observed reachable by a probe. Null = never.' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
        required: ['name', 'type'],
      },
      Port: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nodeId: { type: 'string' },
          portNumber: { type: 'integer', minimum: 1, maximum: 65535 },
          protocol: { type: 'string', enum: ['tcp', 'udp'] },
          serviceName: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['in_use', 'reserved'] },
          domain: { type: 'string' },
          exposure: { type: 'string', enum: ['internal', 'lan', 'public'] },
          scheme: { type: 'string', enum: ['http', 'https'] },
          hostPort: { type: 'integer', nullable: true },
          targetNodeId: { type: 'string', nullable: true },
          lastSeen: { type: 'string', nullable: true, description: 'ISO-8601 UTC time this port last accepted a TCP connect during a probe. Null = never.' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
        required: ['portNumber'],
      },
      Network: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          cidr: { type: 'string', example: '10.20.30.0/24' },
          vlanId: { type: 'integer', nullable: true },
          color: { type: 'string' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
        required: ['name'],
      },
      Link: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          fromNodeId: { type: 'string' },
          toNodeId: { type: 'string' },
          type: { type: 'string', enum: ['proxy', 'mount', 'dns', 'custom'] },
          label: { type: 'string' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
        required: ['fromNodeId', 'toNodeId', 'type'],
      },
      TokenMeta: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          prefix: { type: 'string' },
          scope: { type: 'string', enum: ['read', 'read_write'] },
          createdAt: { type: 'string' },
          lastUsedAt: { type: 'string', nullable: true },
          revokedAt: { type: 'string', nullable: true },
          revoked: { type: 'boolean' },
        },
      },
      DataBundle: {
        type: 'object',
        properties: {
          nodes: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
          ports: { type: 'array', items: { $ref: '#/components/schemas/Port' } },
          networks: { type: 'array', items: { $ref: '#/components/schemas/Network' } },
          links: { type: 'array', items: { $ref: '#/components/schemas/Link' } },
        },
      },
      ProbeSummary: {
        type: 'object',
        properties: {
          probed: { type: 'integer', description: 'Number of nodes probed' },
          up: { type: 'integer' },
          down: { type: 'integer' },
          unknown: { type: 'integer', description: 'Nodes with nothing probeable (no IPv4 address / no TCP ports)' },
          timeoutMs: { type: 'integer' },
          concurrency: { type: 'integer' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nodeId: { type: 'string' },
                name: { type: 'string' },
                ipAddress: { type: 'string' },
                status: { type: 'string', enum: ['up', 'down', 'unknown'] },
                lastSeen: { type: 'string', nullable: true },
                probeablePorts: { type: 'integer' },
                openPorts: { type: 'integer' },
                ports: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      portId: { type: 'string' },
                      portNumber: { type: 'integer' },
                      protocol: { type: 'string', enum: ['tcp', 'udp'] },
                      open: { type: 'boolean' },
                      httpOk: { type: 'boolean', description: 'HTTP(S) HEAD confirmed an app is listening' },
                      skipped: { type: 'boolean' },
                      reason: { type: 'string' },
                      lastSeen: { type: 'string', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      ImportPreviewNode: {
        type: 'object',
        description: 'A parsed node. `ref` correlates it to preview ports (nodeRef).',
        properties: {
          ref: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['physical', 'proxmox_host', 'vm', 'lxc', 'docker_host', 'container', 'network_device', 'iot'] },
          ipAddress: { type: 'string' },
          status: { type: 'string', enum: ['up', 'down', 'unknown'] },
          role: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      ImportPreviewPort: {
        type: 'object',
        description: 'A parsed port. `nodeRef` points to a preview node ref; `nodeId` targets an existing node.',
        properties: {
          nodeRef: { type: 'string', nullable: true },
          nodeId: { type: 'string', nullable: true },
          portNumber: { type: 'integer', minimum: 1, maximum: 65535 },
          protocol: { type: 'string', enum: ['tcp', 'udp'] },
          serviceName: { type: 'string' },
          hostPort: { type: 'integer', nullable: true },
          exposure: { type: 'string', enum: ['internal', 'lan', 'public'] },
          scheme: { type: 'string', enum: ['http', 'https'] },
          description: { type: 'string' },
        },
      },
      ImportPreview: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['docker_ps', 'ss', 'proxmox', 'nmap'] },
          nodes: { type: 'array', items: { $ref: '#/components/schemas/ImportPreviewNode' } },
          ports: { type: 'array', items: { $ref: '#/components/schemas/ImportPreviewPort' } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      ImportApplyRequest: {
        type: 'object',
        description: 'Typically the previewed payload (possibly user-edited).',
        properties: {
          nodes: { type: 'array', items: { $ref: '#/components/schemas/ImportPreviewNode' } },
          ports: { type: 'array', items: { $ref: '#/components/schemas/ImportPreviewPort' } },
          parentId: { type: 'string', nullable: true, description: 'Default parent for created nodes' },
          networkId: { type: 'string', nullable: true, description: 'Default network for created nodes' },
          nodeId: { type: 'string', nullable: true, description: 'Default target node for ports lacking node association (e.g. ss)' },
        },
      },
      ImportApplyResult: {
        type: 'object',
        properties: {
          created: { type: 'object', properties: { nodes: { type: 'integer' }, ports: { type: 'integer' } } },
          skipped: { type: 'object', properties: { nodes: { type: 'integer' }, ports: { type: 'integer' } } },
          nodes: { type: 'object', properties: { created: { type: 'array', items: { type: 'object' } }, skipped: { type: 'array', items: { type: 'object' } } } },
          ports: { type: 'object', properties: { created: { type: 'array', items: { type: 'object' } }, skipped: { type: 'array', items: { type: 'object' } } } },
        },
      },
    },
  },
  paths: {
    '/api/auth/status': { get: { tags: ['auth'], summary: 'Auth state', responses: { 200: { description: 'OK' } } } },
    '/api/auth/setup': { post: { tags: ['auth'], summary: 'First-run: create password', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { password: { type: 'string' } }, required: ['password'] } } } }, responses: { 201: { description: 'Created' }, 409: errorResponse } } },
    '/api/auth/login': { post: { tags: ['auth'], summary: 'Login (session)', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { password: { type: 'string' } }, required: ['password'] } } } }, responses: { 200: { description: 'OK' }, 401: errorResponse } } },
    '/api/auth/logout': { post: { tags: ['auth'], summary: 'Logout', responses: { 200: { description: 'OK' } } } },
    '/api/auth/change-password': { post: { tags: ['auth'], summary: 'Change password (session only)', security: [{ cookieAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } }, required: ['currentPassword', 'newPassword'] } } } }, responses: { 200: { description: 'OK' }, 401: errorResponse } } },

    '/api/tokens': {
      get: { tags: ['tokens'], summary: 'List API tokens (metadata only)', security: [{ cookieAuth: [] }], responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TokenMeta' } } } } }, 401: errorResponse } },
      post: { tags: ['tokens'], summary: 'Create API token — returns plaintext ONCE', security: [{ cookieAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scope: { type: 'string', enum: ['read', 'read_write'] } }, required: ['name'] } } } }, responses: { 201: { description: 'Created', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/TokenMeta' }, { type: 'object', properties: { token: { type: 'string', example: 'hst_ab12...' } } }] } } } }, 401: errorResponse } },
    },
    '/api/tokens/{id}': { delete: { tags: ['tokens'], summary: 'Revoke API token', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: errorResponse } } },

    '/api/nodes': {
      get: { tags: ['nodes'], summary: 'List nodes', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } } } } },
      post: { tags: ['nodes'], summary: 'Create node', security: [{ cookieAuth: [] }, { bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } }, responses: { 201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } }, 400: errorResponse, 401: errorResponse, 403: errorResponse } },
    },
    '/api/nodes/{id}': {
      get: { tags: ['nodes'], summary: 'Get node', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } }, 404: errorResponse } },
      put: { tags: ['nodes'], summary: 'Update node', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } }, responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse } },
      delete: { tags: ['nodes'], summary: 'Delete node (children reparent to grandparent)', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: errorResponse } },
    },
    '/api/nodes/{id}/ports': {
      get: { tags: ['ports'], summary: 'List ports for node', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Port' } } } } }, 404: errorResponse } },
      post: { tags: ['ports'], summary: 'Create port on node', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Port' } } } }, responses: { 201: { description: 'Created' }, 409: { ...errorResponse, description: 'Port conflict (node_id, port_number, protocol)' } } },
    },
    '/api/nodes/{id}/free-ports': {
      get: { tags: ['ports'], summary: 'Free ports in a range', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'from', in: 'query', schema: { type: 'integer', default: 8000 } }, { name: 'to', in: 'query', schema: { type: 'integer', default: 9000 } }, { name: 'protocol', in: 'query', schema: { type: 'string', enum: ['tcp', 'udp'], default: 'tcp' } }], responses: { 200: { description: 'OK' }, 404: errorResponse } },
    },
    '/api/ports/{id}': {
      put: { tags: ['ports'], summary: 'Update port', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Port' } } } }, responses: { 200: { description: 'OK' }, 404: errorResponse, 409: errorResponse } },
      delete: { tags: ['ports'], summary: 'Delete port', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: errorResponse } },
    },
    '/api/networks': {
      get: { tags: ['networks'], summary: 'List networks', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Network' } } } } } } },
      post: { tags: ['networks'], summary: 'Create network', security: [{ cookieAuth: [] }, { bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Network' } } } }, responses: { 201: { description: 'Created' }, 400: errorResponse } },
    },
    '/api/networks/{id}': {
      put: { tags: ['networks'], summary: 'Update network', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Network' } } } }, responses: { 200: { description: 'OK' }, 404: errorResponse } },
      delete: { tags: ['networks'], summary: 'Delete network', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: errorResponse } },
    },
    '/api/networks/{id}/free-ips': {
      get: { tags: ['networks'], summary: 'Free host IPs in the network CIDR', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 256, maximum: 4096 } }], responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse } },
    },
    '/api/links': {
      get: { tags: ['links'], summary: 'List links', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Link' } } } } } } },
      post: { tags: ['links'], summary: 'Create link', security: [{ cookieAuth: [] }, { bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Link' } } } }, responses: { 201: { description: 'Created' }, 400: errorResponse } },
    },
    '/api/links/{id}': {
      put: { tags: ['links'], summary: 'Update link', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Link' } } } }, responses: { 200: { description: 'OK' }, 404: errorResponse } },
      delete: { tags: ['links'], summary: 'Delete link', security: [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: errorResponse } },
    },
    '/api/topology': { get: { tags: ['data'], summary: 'Graph-shaped topology (nodes, ports, networks, links, edges)', responses: { 200: { description: 'OK' } } } },
    '/api/export': { get: { tags: ['data'], summary: 'Full export (JSON migration contract)', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataBundle' } } } } } } },
    '/api/import': { post: { tags: ['data'], summary: 'Replace-all import (transactional)', security: [{ cookieAuth: [] }, { bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/DataBundle' } } } }, responses: { 200: { description: 'OK' }, 400: errorResponse } } },

    '/api/probe': {
      post: {
        tags: ['probe'],
        summary: 'Active health check — probe all nodes (or a subset)',
        description: 'TCP-connects to each node\'s tcp ports (IPv4). Sets port.last_seen on success and the node\'s status (up/down) + last_seen. Never overwrites port.status. Mutating → auth required.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { nodeIds: { type: 'array', items: { type: 'string' }, description: 'Omit to probe everything' }, timeout: { type: 'integer', description: 'Per-connect timeout ms (200..10000, default 1500)' }, concurrency: { type: 'integer', description: 'Max parallel connects (1..20, default 10)' } } } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProbeSummary' } } } }, 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    '/api/nodes/{id}/probe': {
      post: {
        tags: ['probe'],
        summary: 'Active health check — probe one node + its ports',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { timeout: { type: 'integer' }, concurrency: { type: 'integer' } } } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProbeSummary' } } } }, 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    '/api/import/parse': {
      post: {
        tags: ['import'],
        summary: 'Parse real command output into a preview (dry-run, no writes)',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { source: { type: 'string', enum: ['docker_ps', 'ss', 'proxmox', 'nmap'] }, text: { type: 'string', description: 'Raw command output' } }, required: ['source', 'text'] } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ImportPreview' } } } }, 400: errorResponse, 401: errorResponse, 403: errorResponse },
      },
    },
    '/api/import/apply': {
      post: {
        tags: ['import'],
        summary: 'Apply a preview payload additively (one transaction, de-duped)',
        description: 'Creates nodes/ports from a (possibly edited) preview. De-dupes nodes by name or ipAddress and ports by (node, portNumber, protocol). Additive — unlike replace-all POST /api/import.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ImportApplyRequest' } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ImportApplyResult' } } } }, 400: errorResponse, 401: errorResponse, 403: errorResponse },
      },
    },
    '/api/llm/context': { get: { tags: ['llm'], summary: 'Whole homelab as { summary (markdown), data }', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { summary: { type: 'string' }, data: { $ref: '#/components/schemas/DataBundle' } } } } } } } } },
    '/api/openapi.json': { get: { tags: ['llm'], summary: 'This OpenAPI spec', responses: { 200: { description: 'OK' } } } },
  },
};

module.exports = { spec };
