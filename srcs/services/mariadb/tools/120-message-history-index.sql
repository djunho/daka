-- Non-destructive, repeatable migration for existing MariaDB volumes.
CREATE INDEX IF NOT EXISTS idx_messages_negotiation_id
    ON messages (negotiation_id, id);
