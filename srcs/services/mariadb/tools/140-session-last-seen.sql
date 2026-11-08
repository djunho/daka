-- Non-destructive, repeatable migration for existing MariaDB volumes.
-- On a new volume schema.sql already created the column, so this is a no-op.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at DATETIME NULL DEFAULT NULL AFTER expires_at;
