CREATE TABLE IF NOT EXISTS cli_error_reports (
	id TEXT PRIMARY KEY,
	cli_version TEXT NOT NULL,
	node_version TEXT NOT NULL,
	platform TEXT NOT NULL,
	arch TEXT NOT NULL,
	command TEXT NOT NULL,
	error_name TEXT NOT NULL,
	error_message TEXT NOT NULL,
	stack TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cli_error_reports_created_at
ON cli_error_reports (created_at DESC);
