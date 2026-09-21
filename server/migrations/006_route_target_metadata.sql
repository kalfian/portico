-- Explicit Cloudflare target host/port for databases created before v5.
ALTER TABLE cloudflare_routes ADD COLUMN target_host TEXT NOT NULL DEFAULT '';
ALTER TABLE cloudflare_routes ADD COLUMN target_port INTEGER;