CREATE TABLE node_parents (
  node_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, parent_id),
  CHECK (node_id <> parent_id)
);

CREATE INDEX idx_node_parents_parent ON node_parents(parent_id);

INSERT INTO node_parents (node_id, parent_id, created_at)
SELECT id, parent_id, updated_at
FROM nodes
WHERE parent_id IS NOT NULL;
