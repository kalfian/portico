'use strict';

// Shared helpers for the source importers. All parsers are defensive: they never
// throw on messy input, they collect human-readable warnings instead.

// Infer http vs https from a port number / service hint (mirrors store.inferScheme).
function inferScheme(portNumber, serviceHint) {
  const s = String(serviceHint || '').toLowerCase();
  if (s.includes('https') || s.includes('ssl') || s === 'https-alt') return 'https';
  const n = Number(portNumber);
  if (n === 443 || n === 8443) return 'https';
  return 'http';
}

// Non-throwing line splitter that drops blank lines and trims trailing CR.
function toLines(text) {
  return String(text == null ? '' : text)
    .replace(/\r/g, '')
    .split('\n');
}

module.exports = { inferScheme, toLines };
