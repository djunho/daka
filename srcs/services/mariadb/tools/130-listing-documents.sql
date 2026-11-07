-- Non-destructive, repeatable migration for existing MariaDB volumes (#178).
-- On a new volume schema.sql already created the table, so this is a no-op.
CREATE TABLE IF NOT EXISTS documents (
	id 				INT AUTO_INCREMENT PRIMARY KEY,
	listing_id 		INT NOT NULL,
	file_name		VARCHAR(64) NOT NULL,
	original_name	VARCHAR(150) NOT NULL,
	size_bytes		INT NOT NULL,
	page_count		SMALLINT NOT NULL,
	created_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

	FOREIGN KEY (listing_id)
		REFERENCES listings(id)
);
