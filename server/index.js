'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

require('./db'); // opens DB + runs migrations on require
const { seedIfEmpty } = require('./seed');
const { authenticate } = require('./auth');
const { ApiError } = require('./lib/util');

const PORT = Number(process.env.PORT) || 3000;
// Signs the session cookie. Set SESSION_SECRET in any real deployment.
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-home-topology';
// `secure` cookie is opt-in (enable once behind an HTTPS reverse proxy).
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

// Seed sample topology on first boot (idempotent).
seedIfEmpty();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' })); // 10mb headroom for icon data-URLs in import

app.use(
  session({
    name: 'hst.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// --- API ---
// Populate req.auth (session or bearer token) for all API routes before guards run.
app.use('/api', authenticate);
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/tokens'));
app.use('/api', require('./routes/nodes'));
app.use('/api', require('./routes/ports'));
app.use('/api', require('./routes/networks'));
app.use('/api', require('./routes/links'));
app.use('/api', require('./routes/probe'));
app.use('/api', require('./routes/import'));
app.use('/api', require('./routes/icons'));
app.use('/api', require('./routes/data'));

// Unknown API route → JSON 404 (don't fall through to static/index.html).
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found' } }));

// --- static frontend (populated in a later phase) ---
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// --- centralized error handler ---
// Consistent shape: { error: { code, message } }.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof ApiError ? err.status : 500;
  const code = err instanceof ApiError ? err.code : 'internal_error';
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: { code, message: err.message || 'Internal server error' } });
});

const server = app.listen(PORT, () => {
  console.log(`[server] Home Server Topology API listening on http://localhost:${PORT}`);
});

// Graceful shutdown for Docker / nodemon.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

module.exports = app;
