# Home Server Topology & Port Manager

Self-hosted tool to map home-server topology (parent→child containment + typed
relationships) and inventory ports per node. This is the **Fase 2 backend**:
Node + Express + SQLite (better-sqlite3). The interactive frontend ships in a
later phase; Express already serves `public/` (currently a placeholder).

## Run locally

```bash
npm install
npm run dev      # node --watch server/index.js (auto-restart)
# or
npm start        # node server/index.js
```

Then open http://localhost:3000 (placeholder page) and hit the API under `/api`.
On first boot the DB is created at `data/topology.db` (WAL mode) and seeded with a
sample topology.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | HTTP listen port |
| `DB_PATH` | `data/topology.db` | SQLite file path (Docker volume later) |
| `SESSION_SECRET` | `change-me-home-topology` | Signs the session cookie — **set this in any real deployment** |
| `COOKIE_SECURE` | `false` | Set `true` when behind an HTTPS reverse proxy |

## Auth model

Single-password gate. **Reads are public; all mutations require login.**

- Password hashed with node's built-in `crypto.scryptSync` (salt + timing-safe compare) — no native build deps.
- Session via `express-session` (in-memory store; re-login after a restart is expected for a single-user homelab). Cookie is `httpOnly`; `secure` gated by `COOKIE_SECURE`.
- First run: `POST /api/auth/setup` creates the password (only allowed if none set), then you're logged in.

## API surface

Reads (public):
- `GET /api/nodes`, `GET /api/nodes/:id`
- `GET /api/nodes/:id/ports`, `GET /api/nodes/:id/free-ports?from=&to=&protocol=`
- `GET /api/networks`, `GET /api/networks/:id/free-ips?limit=`
- `GET /api/links`
- `GET /api/topology`, `GET /api/export`
- `GET /api/auth/status`

Mutations (require session):
- `POST /api/nodes`, `PUT /api/nodes/:id`, `DELETE /api/nodes/:id`
- `POST /api/nodes/:id/ports`, `PUT /api/ports/:id`, `DELETE /api/ports/:id`
- `POST /api/networks`, `PUT /api/networks/:id`, `DELETE /api/networks/:id`
- `POST /api/links`, `PUT /api/links/:id`, `DELETE /api/links/:id`
- `POST /api/import` (replace-all, transactional)
- `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`

JSON is camelCase; the DB is snake_case (mapped in `server/lib/mappers.js`).

## Schema & migrations

Hand-written SQL in `server/migrations/`, applied on boot inside a transaction and
tracked with `PRAGMA user_version` (no ORM). `PRAGMA journal_mode=WAL` and
`PRAGMA foreign_keys=ON` are set per connection.

Entities: `nodes` (self-referential hierarchy, `parent_id` FK ON DELETE SET NULL),
`ports` (FK ON DELETE CASCADE, `UNIQUE(node_id, port_number, protocol)`), `networks`,
`links` (typed edges), `tags` + `node_tags` (join table). Auth in a single-row `auth` table.

Server-side guards mirror the prototype: port uniqueness (409), parent-cycle prevention
(400), IPv4 format validation, enum whitelisting, and reparent-to-grandparent on node delete.

## Seed

`server/seed.js` runs only when the DB is empty. It replicates the prototype's sample
topology exactly (dialga/Proxmox + guests, docker-host + containers, mikrotik/AP/IoT,
the ports incl. hostPort/targetNode mappings, the servers/iot/docker networks, the seed
links, and the selfh.st icon slugs).

## Docker

Fase 3 — a `Dockerfile` + `docker-compose.yml` with a `./data` volume come later.
