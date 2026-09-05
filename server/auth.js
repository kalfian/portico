'use strict';

// Single-password gate. Hash = scrypt(password, salt) with a timing-safe compare.
// No native build deps (scrypt is in node's crypto core) — keeps the Docker image simple.

const crypto = require('crypto');
const { db } = require('./db');
const { now, ApiError } = require('./lib/util');
const tokens = require('./tokens');

const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
}

function getAuthRow() {
  return db.prepare('SELECT * FROM auth WHERE id = 1').get();
}

function isSetup() {
  return !!getAuthRow();
}

// First-run: create the password. Rejected if one already exists.
function setup(password) {
  if (isSetup()) throw new ApiError(409, 'Password already set — use change-password instead');
  if (!password || String(password).length < 6) throw new ApiError(400, 'password must be at least 6 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const ts = now();
  db.prepare('INSERT INTO auth (id, password_salt, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?, ?)')
    .run(salt, hash, ts, ts);
  return true;
}

// Timing-safe verification of a candidate password against the stored hash.
function verify(password) {
  const row = getAuthRow();
  if (!row) return false;
  const candidate = Buffer.from(hashPassword(password, row.password_salt), 'hex');
  const stored = Buffer.from(row.password_hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function changePassword(currentPassword, newPassword) {
  if (!isSetup()) throw new ApiError(400, 'No password set — use setup first');
  if (!verify(currentPassword)) throw new ApiError(401, 'Current password is incorrect');
  if (!newPassword || String(newPassword).length < 6) throw new ApiError(400, 'newPassword must be at least 6 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(newPassword, salt);
  db.prepare('UPDATE auth SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = 1')
    .run(salt, hash, now());
  return true;
}

// --- request authentication ----------------------------------------------
//
// Trust model:
//   - reads are public;
//   - mutations require EITHER a logged-in session OR a `read_write` bearer token;
//   - a `read` token authenticates but may only perform reads (403 on mutation);
//   - token management + change-password require a SESSION (never a token).
//
// authenticate() is non-blocking: it just populates req.auth for downstream guards.
function authenticate(req, res, next) {
  req.auth = { method: null, scope: null };
  if (req.session && req.session.authenticated) {
    req.auth = { method: 'session', scope: 'read_write' };
    return next();
  }
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const row = tokens.verifyToken(m[1].trim());
    if (row) {
      tokens.touchToken(row.id);
      req.auth = { method: 'token', scope: row.scope, tokenId: row.id };
    }
  }
  next();
}

// Guard for mutating endpoints.
function requireWrite(req, res, next) {
  if (req.auth && req.auth.scope === 'read_write') return next();
  if (req.auth && req.auth.scope === 'read') {
    return next(new ApiError(403, 'This token is read-only (scope: read)', 'forbidden_scope'));
  }
  return next(new ApiError(401, 'Authentication required', 'unauthorized'));
}

// Guard for interactive-only endpoints (token management, change-password).
function requireSession(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return next(new ApiError(401, 'Session authentication required', 'unauthorized'));
}

module.exports = { isSetup, setup, verify, changePassword, authenticate, requireWrite, requireSession };
