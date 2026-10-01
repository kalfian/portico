'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../mcp/server');
const {
  PorticoClient,
  parseBaseUrl,
  parseToken,
} = require('../mcp/portico-client');

const PROJECT_DIR = path.resolve(__dirname, '..');

function textResult(result) {
  const item = result.content && result.content.find((entry) => entry.type === 'text');
  assert.ok(item, 'tool result must include text content');
  return JSON.parse(item.text);
}

async function startApi() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portico-mcp-api-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      DB_PATH: path.join(dir, 'mcp.db'),
      PORT: '0',
      HOST: '127.0.0.1',
      SESSION_SECRET: 'mcp-test-session-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const port = await new Promise((resolve, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => reject(new Error(`API startup timed out: ${stderr}`)), 10000);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      fs.rmSync(dir, { recursive: true, force: true });
      const error = new Error(`API exited before ready (${code}): ${stderr}`);
      if (/listen EPERM/.test(stderr)) error.code = 'LOOPBACK_LISTEN_DENIED';
      reject(error);
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let cookie = '';

  async function request(apiPath, method = 'GET', body, expected = 200) {
    const response = await fetch(`${baseUrl}/api${apiPath}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return data;
  }

  await request('/auth/setup', 'POST', { password: 'mcp-test-password' }, 201);
  const readToken = (await request('/tokens', 'POST', { name: 'mcp-read-test', scope: 'read' }, 201)).token;
  const writeToken = (await request('/tokens', 'POST', { name: 'mcp-write-test', scope: 'read_write' }, 201)).token;

  const bundle = await request('/export');
  bundle.cloudflareRoutes.push({
    id: 'cf-mcp-test',
    hostname: 'mcp.example.invalid',
    target: 'http://10.77.0.10:8443',
    targetHost: '10.77.0.10',
    targetPort: 8443,
    exposure: 'public',
    source: 'manual',
  });
  await request('/import', 'POST', bundle);

  return {
    baseUrl,
    readToken,
    writeToken,
    request,
    async close() {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function startMcp(baseUrl, token) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['mcp/server.js'],
    cwd: PROJECT_DIR,
    env: {
      PATH: process.env.PATH || '',
      PORTICO_URL: baseUrl,
      ...(token ? { PORTICO_TOKEN: token } : {}),
    },
    stderr: 'pipe',
    maxBufferSize: 3 * 1024 * 1024,
  });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk; });
  const client = new Client({ name: 'portico-mcp-test', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const safeStderr = token ? stderr.split(token).join('[redacted]') : stderr;
    throw new Error(`MCP stdio startup failed: ${error.message}; stderr: ${safeStderr}`);
  }
  return {
    client,
    getStderr: () => stderr,
    async close() {
      await client.close();
    },
  };
}

async function childStdioWorks() {
  const child = spawn(process.execPath, ['-e', [
    "process.stdin.on('data', chunk => process.stdout.write(chunk));",
    'setInterval(() => {}, 10000);',
  ].join('')], { stdio: ['pipe', 'pipe', 'ignore'] });
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), 1000);
    const finish = (supported) => {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill('SIGTERM');
      resolve(supported);
    };
    child.stdout.once('data', (chunk) => finish(chunk.toString() === 'portico-stdio-check'));
    child.once('exit', () => finish(false));
    child.stdin.write('portico-stdio-check');
  });
}

test('MCP configuration accepts safe URLs and sanitizes API errors', async () => {
  assert.equal(parseBaseUrl(undefined).href, 'http://127.0.0.1:3000/');
  assert.equal(parseBaseUrl('https://portico.example.test').href, 'https://portico.example.test/');
  assert.throws(() => parseBaseUrl('http://portico.example.test'), /must use https/);
  assert.throws(() => parseBaseUrl('https://user:pass@portico.example.test'), /cannot contain credentials/);
  assert.throws(() => parseBaseUrl('https://portico.example.test/base'), /must not contain a path/);
  assert.throws(() => parseBaseUrl('https://portico.example.test?'), /cannot contain whitespace/);
  assert.throws(() => parseToken('not-a-portico-token'), /not a valid/);

  const token = `hst_${'a'.repeat(64)}`;
  const client = new PorticoClient({
    baseUrl: 'http://127.0.0.1:3000',
    token,
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: 'validation_error', message: `bad bearer ${token}` },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(client.request('POST', '/api/nodes', {}), (error) => {
    assert.equal(error.code, 'validation_error');
    assert.doesNotMatch(error.message, new RegExp(token));
    assert.match(error.message, /\[redacted\]/);
    return true;
  });
});

test('SDK client/server validates tools and sanitizes HTTP authorization failures', async () => {
  const token = `hst_${'b'.repeat(64)}`;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), method: options.method, authorization: options.headers.Authorization });
    if (options.method === 'POST') {
      return new Response(JSON.stringify({
        error: { code: 'forbidden_scope', message: `read-only ${token}` },
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ summary: 'test context', data: { nodes: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const server = createServer({
    env: { PORTICO_URL: 'http://127.0.0.1:3000', PORTICO_TOKEN: token },
    fetchImpl,
  });
  const client = new Client({ name: 'portico-in-memory-test', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const freePortTool = tools.tools.find((tool) => tool.name === 'portico_find_free_ports');
    const updateNodeTool = tools.tools.find((tool) => tool.name === 'portico_write_update_node');
    assert.ok(freePortTool.inputSchema.properties.nodeId);
    assert.ok(updateNodeTool.inputSchema.properties.nodeId);
    const context = textResult(await client.callTool({ name: 'portico_read_context', arguments: {} }));
    assert.equal(context.summary, 'test context');
    const requestsBeforeInvalidInput = requests.length;
    const invalid = await client.callTool({
      name: 'portico_write_create_port',
      arguments: { nodeId: 'any-node', portNumber: 70000 },
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /65535|Invalid tool input/);
    assert.equal(requests.length, requestsBeforeInvalidInput);
    const emptyUpdate = await client.callTool({
      name: 'portico_write_update_node',
      arguments: { nodeId: 'any-node' },
    });
    assert.equal(emptyUpdate.isError, true);
    assert.equal(textResult(emptyUpdate).error.code, 'invalid_input');
    assert.equal(requests.length, requestsBeforeInvalidInput);
    const excessiveRange = await client.callTool({
      name: 'portico_find_free_ports',
      arguments: { nodeId: 'any-node', from: 1, to: 2002, protocol: 'tcp' },
    });
    assert.equal(excessiveRange.isError, true);
    assert.equal(textResult(excessiveRange).error.code, 'invalid_input');
    assert.equal(requests.length, requestsBeforeInvalidInput);
    const denied = await client.callTool({
      name: 'portico_write_create_network',
      arguments: { name: 'Denied network' },
    });
    assert.equal(denied.isError, true);
    assert.equal(textResult(denied).error.code, 'forbidden_scope');
    assert.doesNotMatch(JSON.stringify(denied), new RegExp(token));
    assert.equal(requests.every((request) => request.authorization === `Bearer ${token}`), true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('stdio MCP advertises bounded tools and validates input before HTTP access', async (t) => {
  if (!await childStdioWorks()) {
    t.skip('sandbox does not pass data through child-process stdio pipes');
    return;
  }
  const mcp = await startMcp('http://127.0.0.1:3000', '');
  try {
    const tools = await mcp.client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    assert.ok(names.has('portico_read_context'));
    assert.ok(names.has('portico_write_create_node'));
    assert.ok(names.has('portico_write_set_cloudflare_route'));
    assert.ok(![...names].some((name) => /shell|url|request/.test(name)));

    const invalid = await mcp.client.callTool({
      name: 'portico_write_create_port',
      arguments: { nodeId: 'any-node', portNumber: 70000 },
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /65535|Invalid tool input/);
  } finally {
    await mcp.close();
  }
});

test('stdio MCP uses a disposable Portico API, enforces scopes and does not leak tokens', async (t) => {
  let api;
  try {
    api = await startApi();
  } catch (error) {
    if (error.code === 'LOOPBACK_LISTEN_DENIED') {
      t.skip('sandbox denies loopback listeners');
      return;
    }
    throw error;
  }
  const readMcp = await startMcp(api.baseUrl, api.readToken);
  const writeMcp = await startMcp(api.baseUrl, api.writeToken);
  try {
    const context = textResult(await readMcp.client.callTool({
      name: 'portico_read_context',
      arguments: {},
    }));
    assert.equal(typeof context.summary, 'string');
    assert.ok(Array.isArray(context.data.nodes));

    const denied = await readMcp.client.callTool({
      name: 'portico_write_create_network',
      arguments: { name: 'Denied network', cidr: '10.76.0.0/24' },
    });
    assert.equal(denied.isError, true);
    assert.equal(textResult(denied).error.code, 'forbidden_scope');
    assert.doesNotMatch(JSON.stringify(denied), new RegExp(api.readToken));

    const network = textResult(await writeMcp.client.callTool({
      name: 'portico_write_create_network',
      arguments: { name: 'MCP test network', cidr: '10.77.0.0/24', vlanId: 77 },
    }));
    const host = textResult(await writeMcp.client.callTool({
      name: 'portico_write_create_node',
      arguments: {
        name: 'MCP host',
        type: 'docker_host',
        ipAddress: '10.77.0.10',
        networkId: network.id,
        tags: ['mcp-test'],
      },
    }));
    const app = textResult(await writeMcp.client.callTool({
      name: 'portico_write_create_node',
      arguments: { name: 'MCP app', type: 'container', parentId: host.id, ipAddress: '10.77.0.11' },
    }));
    const port = textResult(await writeMcp.client.callTool({
      name: 'portico_write_create_port',
      arguments: { nodeId: app.id, portNumber: 8443, serviceName: 'mcp-test', scheme: 'https' },
    }));
    const routedPort = textResult(await writeMcp.client.callTool({
      name: 'portico_write_set_cloudflare_route',
      arguments: { portId: port.id, cloudflareRouteId: 'cf-mcp-test' },
    }));
    assert.equal(routedPort.cloudflareRouteId, 'cf-mcp-test');
    assert.equal(routedPort.domain, 'mcp.example.invalid');

    const link = textResult(await writeMcp.client.callTool({
      name: 'portico_write_create_link',
      arguments: { fromNodeId: host.id, toNodeId: app.id, type: 'proxy', label: 'MCP test link' },
    }));
    const updatedLink = textResult(await writeMcp.client.callTool({
      name: 'portico_write_update_link',
      arguments: { linkId: link.id, label: 'Updated MCP test link' },
    }));
    assert.equal(updatedLink.label, 'Updated MCP test link');

    const inventory = textResult(await writeMcp.client.callTool({
      name: 'portico_read_inventory',
      arguments: {},
    }));
    const item = inventory.find((entry) => entry.port.id === port.id);
    assert.equal(item.owner.id, app.id);
    assert.equal(item.server.id, host.id);
    assert.equal(item.cloudflareRoute.id, 'cf-mcp-test');

    assert.equal(textResult(await writeMcp.client.callTool({
      name: 'portico_write_delete_link', arguments: { linkId: link.id, confirm: true },
    })).deleted, true);
    assert.equal(textResult(await writeMcp.client.callTool({
      name: 'portico_write_delete_port', arguments: { portId: port.id, confirm: true },
    })).deleted, true);
    assert.equal(textResult(await writeMcp.client.callTool({
      name: 'portico_write_delete_node', arguments: { nodeId: app.id, confirm: true },
    })).deleted, true);
    assert.equal(textResult(await writeMcp.client.callTool({
      name: 'portico_write_delete_node', arguments: { nodeId: host.id, confirm: true },
    })).deleted, true);
    assert.equal(textResult(await writeMcp.client.callTool({
      name: 'portico_write_delete_network', arguments: { networkId: network.id, confirm: true },
    })).deleted, true);

    assert.doesNotMatch(readMcp.getStderr(), new RegExp(api.readToken));
    assert.doesNotMatch(writeMcp.getStderr(), new RegExp(api.writeToken));
  } finally {
    await readMcp.close();
    await writeMcp.close();
    await api.close();
  }
});
