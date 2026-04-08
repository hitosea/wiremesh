-- For each existing line, create a default branch
INSERT INTO line_branches (line_id, name, is_default, created_at, updated_at)
SELECT id, '默认出口', 1, datetime('now'), datetime('now') FROM lines;

-- Set branch_id on line_nodes (relay/exit)
UPDATE line_nodes SET branch_id = (
  SELECT lb.id FROM line_branches lb WHERE lb.line_id = line_nodes.line_id LIMIT 1
) WHERE role != 'entry';

-- Set branch_id on line_tunnels
UPDATE line_tunnels SET branch_id = (
  SELECT lb.id FROM line_branches lb WHERE lb.line_id = line_tunnels.line_id LIMIT 1
);

-- Migrate line_filters to branch_filters (if line_filters exists)
INSERT OR IGNORE INTO branch_filters (branch_id, filter_id)
SELECT lb.id, lf.filter_id
FROM line_filters lf
JOIN line_branches lb ON lb.line_id = lf.line_id;
