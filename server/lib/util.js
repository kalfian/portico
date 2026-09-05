'use strict';

// Short random id, prefixed like the prototype (n-, p-, lk-, nw-).
function uid(prefix = 'id') {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

// ISO-8601 UTC timestamp for created_at / updated_at.
function now() {
  return new Date().toISOString();
}

// IPv4 dotted-quad validation. Empty string / null / undefined are allowed (treated as "unset").
function isValidIpv4(ip) {
  if (ip === undefined || ip === null || ip === '') return true;
  const m = String(ip).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((o) => {
    const n = Number(o);
    return n >= 0 && n <= 255;
  });
}

// Default machine-readable error code per HTTP status (overridable per-throw).
function defaultCodeForStatus(status) {
  switch (status) {
    case 400: return 'validation_error';
    case 401: return 'unauthorized';
    case 403: return 'forbidden_scope';
    case 404: return 'not_found';
    case 409: return 'conflict';
    default: return 'internal_error';
  }
}

// Typed HTTP error carrying a status + machine code, thrown from the store/auth
// layers and formatted by the error middleware as { error: { code, message } }.
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || defaultCodeForStatus(status);
  }
}

// --- IPv4 math for the free-IP finder (mirrors the prototype's ipToInt/parseCidr) ---

function ipToInt(ip) {
  const m = String(ip || '').trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;
}

function intToIp(n) {
  n = n >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function parseCidr(cidr) {
  const m = String(cidr || '').trim().match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!m) return null;
  const base = ipToInt(m[1]);
  const prefix = parseInt(m[2], 10);
  if (base == null || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (base & mask) >>> 0, prefix, mask };
}

function ipInCidr(ip, c) {
  const v = ipToInt(ip);
  return v != null && c && ((v & c.mask) >>> 0) === c.base;
}

module.exports = { uid, now, isValidIpv4, ApiError, ipToInt, intToIp, parseCidr, ipInCidr };
