-- 003_last_seen.sql — active health-check support.
-- Applied inside a transaction when PRAGMA user_version < 3.
-- Adds a nullable ISO-8601 timestamp recording the last time a node/port was
-- observed reachable by a probe. NULL = never successfully probed. Backward
-- compatible: existing rows default to NULL, export/import round-trip the field.

ALTER TABLE nodes ADD COLUMN last_seen TEXT;
ALTER TABLE ports ADD COLUMN last_seen TEXT;
