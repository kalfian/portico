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
- `POST /api/probe`, `POST /api/nodes/:id/probe` (active health check)
- `POST /api/import/parse`, `POST /api/import/apply` (import from real sources)

Session-only (interactive):
- `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`
- `GET /api/tokens`, `POST /api/tokens`, `DELETE /api/tokens/:id`

JSON is camelCase; the DB is snake_case (mapped in `server/lib/mappers.js`).

## Active health check (probe)

Probe live reachability of nodes and their ports. A short **TCP connect** to
`node.ipAddress : port.portNumber` (IPv4 only, concurrency-capped, hard time
budget) decides reachability; http/https-scheme ports are optionally refined with
an HTTP(S) `HEAD /`. Probes are **mutations** (auth required) and touch only:

- **`port.last_seen`** ← set to now when that port's TCP connect succeeds (never overwrites `port.status` = `in_use`/`reserved`).
- **`node.status`** ← `up` if any port is reachable, `down` if it had probeable TCP ports but none opened. `unknown` (no IPv4 address / no TCP ports) leaves the stored status untouched.
- **`node.last_seen`** ← set to now when the node is `up` (preserved otherwise).

UDP ports and nodes without an IPv4 address are reported as `skipped`.

```bash
# probe everything (or a subset with {"nodeIds":["n-abc","n-def"]})
curl -s -H "Authorization: Bearer hst_<...>" -X POST http://localhost:3000/api/probe \
  -H 'Content-Type: application/json' -d '{"timeout":1500,"concurrency":10}'
# → { "probed":12, "up":9, "down":2, "unknown":1, "timeoutMs":1500, "concurrency":10,
#     "results":[ { "nodeId":"n-...", "status":"up", "lastSeen":"2026-09-05T...",
#                   "ports":[ { "portNumber":443, "protocol":"tcp", "open":true, "httpOk":true, "lastSeen":"..." } ] } ] }

# probe a single node + its ports
curl -s -H "Authorization: Bearer hst_<...>" -X POST http://localhost:3000/api/nodes/n-abc/probe
```

Guardrails: per-request caps (≤200 nodes, ≤2000 ports), per-connect timeout
200–10000 ms (default 1500), concurrency 1–20 (default 10), 60 s overall budget.

## Import from real sources (parse → preview → apply)

Turn real command output into nodes + ports in two steps so you can review before
anything is written. Both steps require auth.

**Step 1 — parse (dry-run, no DB writes):** `POST /api/import/parse` with
`{ source, text }`. `source` ∈ `docker_ps` | `ss` | `proxmox` | `nmap`. Returns a
preview `{ source, nodes, ports, warnings }`. Preview nodes carry a `ref`; preview
ports link to a node via `nodeRef` (points to a preview node's `ref`) — except `ss`
ports, which have `nodeRef:null` (you pick their target node at apply time).

Supported formats per source:

- **`docker_ps`** — both `docker ps` table output **and** `docker ps --format '{{json .}}'` JSON-lines. Container → node (`type:container`); published mappings `0.0.0.0:8080->80/tcp` → port (`portNumber:80`, `hostPort:8080`, `protocol:tcp`), exposure `public` for `0.0.0.0`/`::`, `lan` for a specific host IP, `internal` for exposed-only.
- **`ss`** — `ss -tlnp` / `ss -tulpn` listening sockets → ports (port, protocol, service name from `users:(("name",...))`). Loopback binds → `internal`, all-interface binds → `lan`. Ports come back with no node.
- **`proxmox`** — `qm list` (VMs → `type:vm`) and `pct list` (LXCs → `type:lxc`); name + status, `vmid` in `role`/`notes`.
- **`nmap`** — `nmap -oX -` XML → hosts (nodes by IPv4) + open ports (port, protocol, service name).

```bash
curl -s -H "Authorization: Bearer hst_<...>" -X POST http://localhost:3000/api/import/parse \
  -H 'Content-Type: application/json' \
  -d '{"source":"docker_ps","text":"0.0.0.0:8080->80/tcp   my-web\n"}'
# → { "source":"docker_ps", "nodes":[{"ref":"docker:my-web:0","name":"my-web","type":"container",...}],
#     "ports":[{"nodeRef":"docker:my-web:0","portNumber":80,"hostPort":8080,"protocol":"tcp","exposure":"public",...}],
#     "warnings":[] }
```

**Step 2 — apply (additive, one transaction, de-duped):** `POST /api/import/apply`
with the previewed (optionally edited) payload
`{ nodes, ports, parentId?, networkId?, nodeId? }`. `parentId`/`networkId` set
defaults for created nodes; `nodeId` is the fallback target node for ports lacking
a `nodeId`/`nodeRef` (used for `ss`). De-dupes nodes by name **or** `ipAddress`
and ports by `(node, portNumber, protocol)`; validates IPs/enums/uniqueness via
the same store guards. Returns created vs skipped counts + details.

```bash
curl -s -H "Authorization: Bearer hst_<...>" -X POST http://localhost:3000/api/import/apply \
  -H 'Content-Type: application/json' \
  -d '{"nodes":[{"ref":"r1","name":"my-web","type":"container"}],"ports":[{"nodeRef":"r1","portNumber":80,"protocol":"tcp"}]}'
# → { "created":{"nodes":1,"ports":1}, "skipped":{"nodes":0,"ports":0}, "nodes":{...}, "ports":{...} }
```

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
