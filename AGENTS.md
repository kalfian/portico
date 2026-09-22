# Repository Guidelines

## Project Structure & Module Organization

Portico is a CommonJS Node.js application for recording homelab topology and port use. The Express entry point is `server/index.js`; route handlers live in `server/routes/`, domain helpers in `server/lib/`, and SQLite persistence, migrations, authentication, and seed data are in `server/{store,db,auth,seed}.js` and `server/migrations/`. The browser client is intentionally dependency-free: `public/index.html`, `public/app.js`, and `public/styles.css`. Keep documentation screenshots in `docs/`; `prototype/` is reference material, not the served application.

## Build, Test, and Development Commands

- `npm install` installs the Node 20+ dependencies.
- `npm run dev` runs `server/index.js` with Node's watch mode for local development.
- `npm start` runs the application normally on port 3000 unless `PORT` is set.
- `docker compose up -d --build` builds and starts the production-like container stack.

There is no configured test runner, formatter, or linter. Before opening a change, start the app and exercise the affected API or UI path manually. For API work, use `curl http://localhost:3000/api/openapi.json` to confirm request and response shapes.

## Coding Style & Naming Conventions

Use CommonJS (`require`/`module.exports`), `'use strict';`, two-space indentation, semicolons, and single-quoted strings, matching existing server code. Keep route modules small and register them from `server/index.js`. Return API JSON in camelCase and preserve the established error shape: `{ error: { code, message } }`. Name resource route files in lower-case plural form, such as `server/routes/nodes.js`. Keep frontend changes in plain JavaScript and CSS; do not introduce a framework without an explicit decision.

## Database, Security, and Configuration

Migrations are ordered SQL files in `server/migrations/`; append a new numbered migration instead of altering one already shipped. Local data defaults to `data/topology.db`; do not commit it. Configure deployments with `PORT`, `DB_PATH`, `SESSION_SECRET`, and `COOKIE_SECURE`; keep real secrets in an untracked `.env` file. Preserve the read-public/write-authenticated API model and validate write paths through `requireWrite`.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects, for example `feat: add node table view` and `docs: rewrite README`. Use a concise imperative subject with a relevant type (`feat`, `fix`, `docs`, `chore`). PRs should state the user-visible behavior, list manual verification, link the relevant issue when one exists, and include screenshots for changes to `public/`.
