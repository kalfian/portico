'use strict';

const DEFAULT_PORTICO_URL = 'http://127.0.0.1:3000/';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class PorticoClientError extends Error {
  constructor(message, { code = 'portico_error', status = null } = {}) {
    super(message);
    this.name = 'PorticoClientError';
    this.code = code;
    this.status = status;
  }
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function parseBaseUrl(rawValue) {
  const value = rawValue === undefined || rawValue === '' ? DEFAULT_PORTICO_URL : rawValue;
  if (value !== value.trim() || /[\r\n?#]/.test(value)) {
    throw new PorticoClientError('PORTICO_URL cannot contain whitespace, a query, or a fragment', { code: 'invalid_configuration' });
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PorticoClientError('PORTICO_URL must be an absolute http(s) URL', { code: 'invalid_configuration' });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new PorticoClientError('PORTICO_URL must use http or https', { code: 'invalid_configuration' });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new PorticoClientError('PORTICO_URL cannot contain credentials, a query, or a fragment', { code: 'invalid_configuration' });
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new PorticoClientError('PORTICO_URL must not contain a path', { code: 'invalid_configuration' });
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new PorticoClientError('Non-loopback PORTICO_URL values must use https', { code: 'invalid_configuration' });
  }
  url.pathname = '/';
  return url;
}

function parseToken(rawValue) {
  if (rawValue === undefined || rawValue === '') return '';
  if (rawValue !== rawValue.trim() || /[\r\n]/.test(rawValue) || !/^hst_[0-9a-f]{64}$/.test(rawValue)) {
    throw new PorticoClientError('PORTICO_TOKEN is not a valid Portico API token', { code: 'invalid_configuration' });
  }
  return rawValue;
}

function sanitizedMessage(value, token) {
  let message = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (token) message = message.split(token).join('[redacted]');
  message = message.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]');
  return message.slice(0, 500) || 'Portico API request failed';
}

async function readLimitedBody(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new PorticoClientError('Portico API response exceeded the MCP size limit', { code: 'response_too_large' });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

class PorticoClient {
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.baseUrl = parseBaseUrl(baseUrl instanceof URL ? baseUrl.href : baseUrl);
    this.token = parseToken(token);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, body) {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith('/api/')) {
      throw new PorticoClientError('Refused an invalid Portico API path', { code: 'invalid_request' });
    }

    const headers = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let requestBody;
    if (body !== undefined) {
      requestBody = JSON.stringify(body);
      if (Buffer.byteLength(requestBody) > MAX_REQUEST_BYTES) {
        throw new PorticoClientError('Tool input is too large', { code: 'invalid_request' });
      }
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    let text;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: requestBody,
        redirect: 'error',
        signal: controller.signal,
      });
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        controller.abort();
        throw new PorticoClientError('Portico API response exceeded the MCP size limit', { code: 'response_too_large' });
      }
      text = await readLimitedBody(response);
    } catch (error) {
      if (error instanceof PorticoClientError) throw error;
      const timedOut = error && (error.name === 'AbortError' || controller.signal.aborted);
      throw new PorticoClientError(
        timedOut ? 'Portico API request timed out' : 'Unable to reach the configured Portico API',
        { code: timedOut ? 'timeout' : 'connection_error' }
      );
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new PorticoClientError('Portico API returned an invalid JSON response', {
            code: 'invalid_response',
            status: response.status,
          });
        }
      }
    }
    if (!response.ok) {
      const apiError = data && typeof data === 'object' ? data.error : null;
      const code = apiError && /^[a-z0-9_-]{1,64}$/i.test(apiError.code) ? apiError.code : 'http_error';
      const message = response.status >= 500
        ? `Portico API request failed with HTTP ${response.status}`
        : sanitizedMessage(apiError && apiError.message ? apiError.message : `Portico API request failed with HTTP ${response.status}`, this.token);
      throw new PorticoClientError(message, { code, status: response.status });
    }
    return data;
  }
}

function clientFromEnv(env = process.env, options = {}) {
  return new PorticoClient({
    ...options,
    baseUrl: parseBaseUrl(env.PORTICO_URL),
    token: parseToken(env.PORTICO_TOKEN),
  });
}

module.exports = {
  DEFAULT_PORTICO_URL,
  MAX_RESPONSE_BYTES,
  PorticoClient,
  PorticoClientError,
  clientFromEnv,
  parseBaseUrl,
  parseToken,
  readLimitedBody,
};
