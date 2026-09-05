# Portico — Home Server Topology & Port Manager

Self-hosted tool to **map your home-server topology** (which machine hosts which VM /
LXC / container / device) and **track which ports are used vs free** on each node —
so you always know your layout and your attack surface.

- 🗺️ Interactive topology graph (containment + typed dependency edges: proxy / mount / dns)
- 🔌 Per-node port inventory with **free-port** and **free-IP** finders
- 🌐 Networks / VLANs, exposure levels (`internal` / `lan` / `public`), duplicate-IP/MAC/port conflict detection
- 🩺 Active **health check** (TCP/HTTP probe → live status + "last seen")
- 📥 **Import** from `docker ps`, `ss`, Proxmox `qm/pct list`, or `nmap` (parse → preview → apply)
- 🤖 **LLM-friendly**: OpenAPI spec + one-call context endpoint + scoped API tokens
- 🔒 Single-password gate (read-only until you log in) · runs great in Docker

Stack: Node + Express + SQLite (better-sqlite3), vanilla vis-network frontend. No cloud, no telemetry, works air-gapped.

---

## Quick start

### Option A — Prebuilt image (fastest)

```bash
docker run -d --name portico -p 3000:3000 -v portico_data:/app/data \
  ghcr.io/kalfian/portico:latest
```

Open **http://localhost:3000** → you'll be asked to **create a password** on first load,
then log in to edit. Data (SQLite DB + cached icons) persists in the `portico_data` volume.

> The image is published to GitHub Container Registry (multi-arch: amd64 + arm64).
> If the package is private, run `docker login ghcr.io` first (PAT with `read:packages`),
> or make it public under the repo's *Packages → portico → Package settings*.

### Option B — Docker Compose (build from source)

```bash
git clone https://github.com/kalfian/portico.git && cd portico
docker compose up -d --build
# → http://localhost:3000
```

### Option C — Local (Node ≥ 20)

```bash
git clone https://github.com/kalfian/portico.git && cd portico
npm install
npm start          # or: npm run dev  (auto-restart on change)
# → http://localhost:3000
```

On first boot the DB is created at `data/topology.db` (WAL mode) and **seeded with a
sample topology** so you have something to look at immediately. Delete `data/` to reset.

---

## For LLMs / AI agents

Portico is built to be driven by an LLM or automation. An agent can **read the whole
homelab in one call** and **make changes with a scoped token**.

**Base URL:** wherever you run it, e.g. `http://homelab.local:3000`.

**1. Understand the topology** (no auth needed — reads are public):

```bash
curl http://localhost:3000/api/llm/context
# → { "summary": "<markdown: hosts→guests, IPs, ports+exposure, networks/VLANs, links>",
#     "data": { "nodes":[...], "ports":[...], "networks":[...], "links":[...] } }
```

`GET /api/llm/context` is the single best entry point — the `summary` is human/LLM-readable
prose, `data` is the full structured state.

**2. Discover the full API** (for tool-calling / function-calling):

```bash
curl http://localhost:3000/api/openapi.json     # complete OpenAPI 3 spec, both auth schemes
```

**3. Make changes** — create a token, then send it as a Bearer header:

- In the UI (logged in): **data menu → API tokens → create** (pick a scope), copy the
  token shown **once**. Or create one over the API from a logged-in session (see [Auth](#auth)).
- **Scopes:** `read` = GET only (safe for observe-only agents); `read_write` = full CRUD.

```bash
TOKEN=hst_xxxxxxxx...
# read anything
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/topology
# create a node (needs read_write)
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/api/nodes \
  -d '{"name":"new-vm","type":"vm","ipAddress":"10.20.30.40","parentId":"n-dialga"}'
```

**Errors** are always `{ "error": { "code": "...", "message": "..." } }` with a matching
HTTP status — e.g. `port_conflict` (409), `cycle_detected` (400), `forbidden_scope` (403).
JSON is camelCase everywhere.

> Tip for agents: `GET /api/llm/context` to orient, `GET /api/openapi.json` to learn the
> exact request shapes, then act with a `read_write` token. Reads never need a token.

---

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `DB_PATH` | `data/topology.db` | SQLite file path (mounted as a volume in Docker) |
| `SESSION_SECRET` | `change-me-home-topology` | Signs the session cookie — **set a strong value in any real deployment** |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS / behind a reverse proxy |

With Compose, put these in a `.env` next to `docker-compose.yml`. Change the host port with
`PORT=8080 docker compose up -d` (maps host `8080` → container `3000`).

---

## Auth

Single-password gate + API bearer tokens.

- **Reads are public** — any `GET` works with no auth (view/observe freely).
- **Mutations require EITHER** a logged-in session **OR** a `read_write` bearer token.
- A `read` token authenticates but may only read (mutations → `403 forbidden_scope`).
- **Token management + change-password require an interactive session** (never a token).
- First run: `POST /api/auth/setup` creates the password (only if none set), then logs you in.

Password is hashed with node's built-in `crypto.scryptSync` (salt + timing-safe compare, no
native build deps). Session via `express-session` (in-memory; re-login after a restart is
expected for a single-user homelab). Tokens: `hst_` + 32 random bytes, stored as a `sha256`
hash + display prefix, plaintext shown **once**, `last_used_at` tracked, revocable.

```bash
# create a token from a logged-in session (cookies.txt holds the session cookie)
curl -b cookies.txt -X POST http://localhost:3000/api/tokens \
  -H 'Content-Type: application/json' -d '{"name":"my-llm","scope":"read_write"}'
curl -b cookies.txt http://localhost:3000/api/tokens                 # list
curl -b cookies.txt -X DELETE http://localhost:3000/api/tokens/<id>  # revoke
```

> This is app-level access control, sensible for a single-user LAN tool. For anything
> internet-facing, also put it behind a reverse proxy (e.g. Traefik + Authelia).

---

## API reference

**Reads (public):**
- `GET /api/nodes`, `GET /api/nodes/:id`
- `GET /api/nodes/:id/ports`, `GET /api/nodes/:id/free-ports?from=&to=&protocol=`
- `GET /api/networks`, `GET /api/networks/:id/free-ips?limit=`
- `GET /api/links`
- `GET /api/topology`, `GET /api/export`
- `GET /api/llm/context`, `GET /api/openapi.json`
- `GET /api/icons/:slug` (cached selfh.st proxy), `GET /api/icons` (index for autocomplete)
- `GET /api/auth/status`

**Mutations (session OR `read_write` token):**
- `POST /api/nodes`, `PUT /api/nodes/:id`, `DELETE /api/nodes/:id`
- `POST /api/nodes/:id/ports`, `PUT /api/ports/:id`, `DELETE /api/ports/:id`
- `POST /api/networks`, `PUT /api/networks/:id`, `DELETE /api/networks/:id`
- `POST /api/links`, `PUT /api/links/:id`, `DELETE /api/links/:id`
- `POST /api/import` (replace-all JSON, transactional)
- `POST /api/probe`, `POST /api/nodes/:id/probe` — [health check](#health-check)
- `POST /api/import/parse`, `POST /api/import/apply` — [import from real sources](#import-from-real-sources)

**Session-only (interactive):**
- `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`
- `GET /api/tokens`, `POST /api/tokens`, `DELETE /api/tokens/:id`

Error codes: `unauthorized` (401), `forbidden_scope` (403), `not_found` (404),
`validation_error` (400), `cycle_detected` (400), `port_conflict` (409), `conflict` (409),
`internal_error` (500).

### Health check

`POST /api/probe` (all, or `{ "nodeIds": [...] }`) and `POST /api/nodes/:id/probe`. A short
IPv4 **TCP connect** to `node.ipAddress:port` decides reachability (http/https ports refined
with a `HEAD /`); concurrency-capped with a hard time budget. It sets `node.status`
(`up`/`down`; `unknown` left untouched) and `last_seen` on the node + each reachable port —
it **never** overwrites a port's `in_use`/`reserved` status. UDP ports and address-less nodes
are reported as `skipped`. Caps: ≤200 nodes / ≤2000 ports, timeout 200–10000 ms (default 1500),
concurrency 1–20 (default 10), 60 s overall budget.

### Import from real sources

Two steps so you review before anything is written (both require auth):

- `POST /api/import/parse` — `{ source, text }`, `source` ∈ `docker_ps` | `ss` | `proxmox` |
  `nmap`. **Dry-run**, returns a preview `{ source, nodes, ports, warnings }`. Preview nodes
  carry a `ref`; preview ports link via `nodeRef` (except `ss` ports → `nodeRef:null`, you
  pick their node at apply time).
- `POST /api/import/apply` — the previewed (optionally edited) payload
  `{ nodes, ports, parentId?, networkId?, nodeId? }`. Additive, one transaction, de-duped
  (nodes by name **or** IP, ports by `(node, port, protocol)`). Returns created vs skipped.

Supported inputs: `docker ps` (table **or** `--format '{{json .}}'`) → containers + published
port mappings; `ss -tlnp`/`-tulpn` → listening ports; Proxmox `qm list` + `pct list` → VMs/LXCs;
`nmap -oX -` XML → hosts + open ports.

```bash
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/api/import/parse \
  -d '{"source":"docker_ps","text":"0.0.0.0:8080->80/tcp   my-web"}'
```

---

## Deployment notes (Docker)

Multi-stage `Dockerfile` — build stage compiles `better-sqlite3`; slim runtime runs as
non-root `node` with a `HEALTHCHECK`. The SQLite DB + cached selfh.st icons live in the
`portico_data` volume (`/app/data`) and survive restarts/rebuilds. Prefer a host path? swap
the volume line in `docker-compose.yml` for `- ./data:/app/data`.

**Publishing:** `.github/workflows/docker-publish.yml` builds and pushes `ghcr.io/kalfian/portico`
(amd64 + arm64) on every push to `main` and on `v*` tags. Tags: `latest` (main), `sha-<short>`
per commit, and `X.Y.Z` / `X.Y` when you push a `vX.Y.Z` tag (`git tag v1.0.0 && git push origin v1.0.0`).

---

## How it's built

- **Frontend** (`public/`) — vanilla JS + vendored vis-network (no CDN), loads state from
  `GET /api/topology`, sends every change through the API, gates editing on the server session.
  Graph + table views, managers, finders, search, animated edges, per-node selfh.st icons
  (via the `/api/icons` caching proxy → air-gap friendly), responsive, reduced-motion aware.
- **Backend** (`server/`) — Express + better-sqlite3, hand-written SQL migrations in
  `server/migrations/` applied on boot inside a transaction (tracked via `PRAGMA user_version`;
  `WAL` + `foreign_keys` on). Entities: `nodes` (self-referential, `parent_id` FK SET NULL),
  `ports` (FK CASCADE, `UNIQUE(node_id, port_number, protocol)`), `networks`, `links`,
  `tags`+`node_tags`, plus `auth` and `api_tokens`. JSON camelCase ↔ DB snake_case in
  `server/lib/mappers.js`. Server-side guards: port uniqueness, parent-cycle prevention,
  IPv4 validation, enum whitelisting, reparent-to-grandparent on node delete.
- **Seed** (`server/seed.js`) — runs only when the DB is empty, replicating a realistic
  sample homelab (Proxmox host + guests, docker host + containers, router/AP/IoT, networks,
  links, and selfh.st icon slugs).

`prototype/index.html` is the original standalone (localStorage-only) prototype, kept for reference.
