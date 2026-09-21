-- Keep legacy reachability and route metadata intact; mode describes access.
ALTER TABLE ports ADD COLUMN exposure_mode TEXT NOT NULL DEFAULT 'lan';
UPDATE ports SET exposure_mode = 'cloudflare' WHERE domain <> '' OR cloudflare_route_id IS NOT NULL;
