-- Link exposed ports to their explicit Cloudflare tunnel route metadata.
ALTER TABLE ports ADD COLUMN cloudflare_route_id TEXT REFERENCES cloudflare_routes(id) ON DELETE SET NULL;
CREATE INDEX idx_ports_cloudflare_route ON ports(cloudflare_route_id);
