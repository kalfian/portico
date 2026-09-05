'use strict';

// API bearer tokens for LLM/automation. Plaintext is high-entropy random, so a
// fast sha256 hash is sufficient (no need for scrypt here). Plaintext is returned
// ONCE at creation; only the hash + a display prefix are persisted.

const crypto = require('crypto');
const { db } = require('./db');
const { uid, now, ApiError } = require('./lib/util');

const SCOPES = ['read', 'read_write'];

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function tokenToApi(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revoked: !!row.revoked_at,
  };
}

function listTokens() {
  return db.prepare('SELECT * FROM api_tokens ORDER BY created_at, rowid').all().map(tokenToApi);
}

// Returns { ...metadata, token: '<plaintext shown once>' }.
function createToken(name, scope) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new ApiError(400, 'name is required');
  const sc = scope || 'read';
  if (!SCOPES.includes(sc)) throw new ApiError(400, `Invalid scope: "${sc}". Allowed: ${SCOPES.join(', ')}`);

  const plaintext = 'hst_' + crypto.randomBytes(32).toString('hex');
  const prefix = plaintext.slice(0, 12); // 'hst_' + 8 hex chars
  const id = uid('tok');
  const ts = now();
  db.prepare('INSERT INTO api_tokens (id, name, token_hash, prefix, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, cleanName, sha256(plaintext), prefix, sc, ts);
  return { ...tokenToApi(db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id)), token: plaintext };
}

function revokeToken(id) {
  const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'Token not found');
  if (!row.revoked_at) db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(now(), id);
  return { id, revoked: true };
}

// Verify a plaintext bearer token → returns the active row, or null if unknown/revoked.
function verifyToken(plaintext) {
  if (!plaintext) return null;
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(plaintext));
  return row || null;
}

function touchToken(id) {
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), id);
}

module.exports = { SCOPES, listTokens, createToken, revokeToken, verifyToken, touchToken };
