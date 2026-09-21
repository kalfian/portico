-- Explicit, manually maintained route metadata for the topology contract.
CREATE TABLE cloudflare_routes (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL DEFAULT '',
  exposure TEXT NOT NULL DEFAULT 'public',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_cloudflare_routes_source ON cloudflare_routes(source);
