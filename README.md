# Home Server Topology & Port Manager

Self-hosted tool to map home-server topology (parent→child containment + typed
relationships) and inventory ports per node. Node + Express + SQLite
(better-sqlite3), with an interactive vis-network frontend served from `public/`.
The UI talks to the REST API below and is gated by the same server-side auth.

## Run locally

```bash
npm install
npm run dev      # node --watch server/index.js (auto-restart)
# or
npm start        # node server/index.js
```

Then open http://localhost:3000 for the interactive UI (or hit the API under `/api`).
On first boot the DB is created at `data/topology.db` (WAL mode) and seeded with a
sample topology, and the app prompts you to create the password on first load.

## Frontend

The `public/` app (vis-network topology graph + port/network/link management,
free-port & free-IP finders, exposure/conflict views, search, per-node selfh.st
icons, animated edges, responsive) is served statically by Express. It loads state
from `GET /api/topology`, sends every change through the REST API, and gates editing
on the server session (read-only until you log in). vis-network is vendored under
`public/vendor/` (no CDN). selfh.st icons load via the caching proxy `GET /api/icons/:slug`
(fetched once, cached under `data/icons/`) so they work air-gapped after a warm cache.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | HTTP listen port |
| `DB_PATH` | `data/topology.db` | SQLite file path (Docker volume later) |
| `SESSION_SECRET` | `change-me-home-topology` | Signs the session cookie — **set this in any real deployment** |
| `COOKIE_SECURE` | `false` | Set `true` when behind an HTTPS reverse proxy |

## Auth model

Single-password gate + API bearer tokens. Trust model:

- **Reads are public** — no auth needed for any `GET`.
- **Mutations require EITHER** a logged-in session **OR** a `read_write` bearer token.
- A `read` bearer token authenticates but may only read (mutations → `403 forbidden_scope`).
- **Token management + change-password require an interactive session** (never a token).

Details:

- Password hashed with node's built-in `crypto.scryptSync` (salt + timing-safe compare) — no native build deps.
- Session via `express-session` (in-memory store; re-login after a restart is expected for a single-user homelab). Cookie is `httpOnly`; `secure` gated by `COOKIE_SECURE`.
- First run: `POST /api/auth/setup` creates the password (only allowed if none set), then you're logged in.

### API tokens (for LLMs / automation)

Create tokens from an authenticated session; the plaintext is shown **once** (GitHub-PAT style — only a `sha256` hash + a display prefix are stored).

```bash
# create a read_write token (needs a logged-in session cookie)
curl -s -b cookies.txt -X POST http://localhost:3000/api/tokens \
  -H 'Content-Type: application/json' -d '{"name":"my-llm","scope":"read_write"}'
# → { "id":"tok-...", "name":"my-llm", "prefix":"hst_ab12cd34", "scope":"read_write", "token":"hst_<64 hex>" }

# use it
curl -H "Authorization: Bearer hst_<...>" http://localhost:3000/api/topology            # any scope
curl -H "Authorization: Bearer hst_<...>" -X POST http://localhost:3000/api/nodes ...    # read_write only

# list / revoke (session required)
curl -b cookies.txt http://localhost:3000/api/tokens
curl -b cookies.txt -X DELETE http://localhost:3000/api/tokens/<id>
```

Scopes: `read` (GET only) · `read_write` (full). `last_used_at` is updated on each use; revoked tokens are rejected immediately.

### LLM-friendly endpoints

- `GET /api/openapi.json` — hand-written OpenAPI 3 spec (all endpoints, schemas, both auth schemes) for tool/LLM discovery.
- `GET /api/llm/context` — the whole homelab in one call: `{ summary: "<markdown>", data: { nodes, ports, networks, links } }`. The markdown describes the host→guest hierarchy, each node's IP/type, notable ports + exposure (public/lan flagged), networks/VLANs, and dependency links.

### Error shape

All API errors return a consistent JSON body:

```json
{ "error": { "code": "port_conflict", "message": "..." } }
```

Codes: `unauthorized` (401), `forbidden_scope` (403), `not_found` (404), `validation_error` (400), `cycle_detected` (400), `port_conflict` (409), `conflict` (409), `internal_error` (500).

## API surface

Reads (public):
- `GET /api/nodes`, `GET /api/nodes/:id`
- `GET /api/nodes/:id/ports`, `GET /api/nodes/:id/free-ports?from=&to=&protocol=`
- `GET /api/networks`, `GET /api/networks/:id/free-ips?limit=`
- `GET /api/links`
- `GET /api/topology`, `GET /api/export`
- `GET /api/llm/context`, `GET /api/openapi.json`
- `GET /api/icons/:slug` (cached selfh.st proxy), `GET /api/icons` (index for autocomplete)
- `GET /api/auth/status`

Mutations (require session OR `read_write` bearer token):
- `POST /api/nodes`, `PUT /api/nodes/:id`, `DELETE /api/nodes/:id`
- `POST /api/nodes/:id/ports`, `PUT /api/ports/:id`, `DELETE /api/ports/:id`
- `POST /api/networks`, `PUT /api/networks/:id`, `DELETE /api/networks/:id`
- `POST /api/links`, `PUT /api/links/:id`, `DELETE /api/links/:id`
- `POST /api/import` (replace-all, transactional)

Session-only (interactive):
- `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`
- `GET /api/tokens`, `POST /api/tokens`, `DELETE /api/tokens/:id`

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

Multi-stage `Dockerfile` (build stage compiles `better-sqlite3`; slim runtime, runs as
non-root `node`, with a `HEALTHCHECK`).

```bash
docker compose up -d --build
# → http://localhost:3000
```

The SQLite DB and the cached selfh.st icons live in the named volume `portico_data`
(`/app/data`), so they persist across restarts and rebuilds. Prefer a host path?
swap the volume line in `docker-compose.yml` for `- ./data:/app/data`.

Set a strong secret for any real deployment (a `.env` next to the compose file works):

```
SESSION_SECRET=<random-long-string>
COOKIE_SECURE=true   # when served over HTTPS / behind a reverse proxy
```

Override the published port with `PORT=8080 docker compose up -d` (maps host `8080`→`3000`).
