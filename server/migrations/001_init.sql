-- 001_init.sql — initial schema for Home Server Topology & Port Manager.
-- Applied inside a transaction when PRAGMA user_version < 1.
-- All FKs rely on PRAGMA foreign_keys=ON (set per-connection in db.js).

CREATE TABLE networks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cidr        TEXT NOT NULL DEFAULT '',
  vlan_id     INTEGER,
  color       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  parent_id   TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  ip_address  TEXT NOT NULL DEFAULT '',
  mac_address TEXT NOT NULL DEFAULT '',
  os          TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'unknown',
  network_id  TEXT REFERENCES networks(id) ON DELETE SET NULL,
  icon_type   TEXT NOT NULL DEFAULT '',
  icon_value  TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  pos_x       REAL NOT NULL DEFAULT 0,
  pos_y       REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_nodes_parent  ON nodes(parent_id);
CREATE INDEX idx_nodes_network ON nodes(network_id);

CREATE TABLE ports (
  id             TEXT PRIMARY KEY,
  node_id        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  port_number    INTEGER NOT NULL,
  protocol       TEXT NOT NULL DEFAULT 'tcp',
  service_name   TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'in_use',
  domain         TEXT NOT NULL DEFAULT '',
  exposure       TEXT NOT NULL DEFAULT 'internal',
  scheme         TEXT NOT NULL DEFAULT 'http',
  host_port      INTEGER,
  target_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (node_id, port_number, protocol)
);

CREATE INDEX idx_ports_node   ON ports(node_id);
CREATE INDEX idx_ports_target ON ports(target_node_id);

CREATE TABLE links (
  id           TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_node_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'custom',
  label        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_links_from ON links(from_node_id);
CREATE INDEX idx_links_to   ON links(to_node_id);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE node_tags (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, tag_id)
);

CREATE INDEX idx_node_tags_tag ON node_tags(tag_id);

-- Single-row auth record (id is pinned to 1). Holds the scrypt salt + hash.
CREATE TABLE auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
