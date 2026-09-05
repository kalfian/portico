'use strict';

// Caching proxy for selfh.st app icons so the UI renders without internet after a
// warm cache (air-gap-friendly homelab). Icons are fetched from the selfh.st CDN
// (via jsDelivr) once, written to <DB dir>/icons, and served from disk thereafter.
//
//   GET /api/icons            → the icon index.json (for search autocomplete)
//   GET /api/icons/:slug      → the PNG for a slug (":slug" may include a .png suffix)
//
// Reads are public (no auth), matching the rest of the GET surface.

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const CDN_PNG = 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/';
const CDN_INDEX = 'https://cdn.jsdelivr.net/gh/selfhst/icons/index.json';

// Cache next to the SQLite file (DB_PATH dir) so a single ./data volume covers both.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'topology.db');
const ICON_DIR = path.join(path.dirname(DB_PATH), 'icons');

function ensureDir() {
  try { fs.mkdirSync(ICON_DIR, { recursive: true }); } catch (_) { /* ignore */ }
}

// Only allow safe slugs (letters, digits, dot, dash, underscore) to avoid path traversal.
function cleanSlug(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (s.endsWith('.png')) s = s.slice(0, -4);
  if (!/^[a-z0-9._-]+$/.test(s) || s.includes('..')) return null;
  return s;
}

// --- index.json (cached ~1 day) ---
router.get('/icons', async (req, res) => {
  ensureDir();
  const file = path.join(ICON_DIR, 'index.json');
  try {
    const stat = fs.existsSync(file) ? fs.statSync(file) : null;
    const fresh = stat && Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000;
    if (fresh) {
      res.type('application/json');
      return fs.createReadStream(file).pipe(res);
    }
    const r = await fetch(CDN_INDEX);
    if (!r.ok) throw new Error('cdn ' + r.status);
    const text = await r.text();
    try { fs.writeFileSync(file, text); } catch (_) { /* best-effort cache */ }
    res.type('application/json').send(text);
  } catch (err) {
    // Offline + no cache → empty list; the client autocomplete degrades to free-text.
    if (fs.existsSync(file)) { res.type('application/json'); return fs.createReadStream(file).pipe(res); }
    res.type('application/json').send('[]');
  }
});

// --- individual PNG icons (cached forever once fetched) ---
router.get('/icons/:slug', async (req, res) => {
  const slug = cleanSlug(req.params.slug);
  if (!slug) return res.status(400).json({ error: { code: 'validation_error', message: 'Invalid icon slug' } });
  ensureDir();
  const file = path.join(ICON_DIR, slug + '.png');
  if (fs.existsSync(file)) {
    res.type('image/png').set('Cache-Control', 'public, max-age=604800');
    return fs.createReadStream(file).pipe(res);
  }
  try {
    const r = await fetch(CDN_PNG + encodeURIComponent(slug) + '.png');
    if (!r.ok) return res.status(404).json({ error: { code: 'not_found', message: 'Icon not found' } });
    const buf = Buffer.from(await r.arrayBuffer());
    try { fs.writeFileSync(file, buf); } catch (_) { /* best-effort cache */ }
    res.type('image/png').set('Cache-Control', 'public, max-age=604800').send(buf);
  } catch (err) {
    res.status(502).json({ error: { code: 'internal_error', message: 'Icon fetch failed (offline?)' } });
  }
});

module.exports = router;
