-- Read-only inventory provenance; NULL preserves manually managed records.
ALTER TABLE nodes ADD COLUMN source TEXT;
ALTER TABLE nodes ADD COLUMN external_id TEXT;
ALTER TABLE nodes ADD COLUMN observed_at TEXT;
ALTER TABLE ports ADD COLUMN source TEXT;
ALTER TABLE ports ADD COLUMN external_id TEXT;
ALTER TABLE ports ADD COLUMN observed_at TEXT;
CREATE INDEX idx_nodes_external ON nodes(source, external_id);
CREATE INDEX idx_ports_external ON ports(source, external_id);
