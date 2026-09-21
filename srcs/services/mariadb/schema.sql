CREATE TABLE users (
	id 				INT AUTO_INCREMENT PRIMARY KEY,
	user_name	 	VARCHAR(100) NOT NULL,
	email 			VARCHAR(255) NOT NULL UNIQUE,
	pass_hash 		VARCHAR(255),
	google_sub		VARCHAR(255) UNIQUE,
	user_role		VARCHAR(20) NOT NULL DEFAULT 'user',
	avatar 			VARCHAR(255),
	user_location 	VARCHAR(100),
	created_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		ON UPDATE CURRENT_TIMESTAMP
);

-- One row per active login. Logging out deletes the row, which is what makes
-- "logout invalidates the session" true rather than aspirational.
CREATE TABLE sessions (
	id				INT AUTO_INCREMENT PRIMARY KEY,
	user_id			INT NOT NULL,
	-- SHA-256 of the token, hex-encoded: always exactly 64 characters, hence
	-- CHAR(64) rather than VARCHAR. The raw token lives only in the user's
	-- cookie -- storing it here would make this table a list of working
	-- passwords for anyone who could read it.
	-- UNIQUE also gives us the index we need: every authenticated request
	-- looks a session up by this column, so it must not be a full table scan.
	token_hash		CHAR(64) NOT NULL UNIQUE,
	-- DATETIME, not TIMESTAMP. TIMESTAMP silently converts values in and out
	-- of the server's timezone and cannot hold dates past 2038; DATETIME
	-- stores exactly what we write. We always write UTC (see
	-- app/security.py:utcnow), so what comes back out is the same instant.
	expires_at		DATETIME NOT NULL,
	created_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

	-- ON DELETE CASCADE: deleting a user takes their sessions with them.
	-- Without it the delete would fail on the foreign key, or worse, leave
	-- orphan sessions pointing at an id that no longer exists.
	FOREIGN KEY (user_id)
		REFERENCES users(id)
		ON DELETE CASCADE
);

CREATE TABLE categories (
    id 				INT AUTO_INCREMENT PRIMARY KEY,
    category_name 	VARCHAR(50) NOT NULL
);

CREATE TABLE conditions
(
    id 				INT AUTO_INCREMENT PRIMARY KEY,
    condition_name 	VARCHAR(50) NOT NULL
);

CREATE TABLE listings_states
(
    id 				INT AUTO_INCREMENT PRIMARY KEY,
    state_name 		VARCHAR(50) NOT NULL
);

CREATE TABLE trade_states
(
    id 				INT AUTO_INCREMENT PRIMARY KEY,
    state_name 		VARCHAR(50) NOT NULL
);

-- Esses sao os anuncios cadastrados
CREATE TABLE listings (
	id 					INT AUTO_INCREMENT PRIMARY KEY,
	user_id 			INT NOT NULL,
	category_id 		INT NOT NULL,
	condition_id 		INT NOT NULL,
	state_id 			INT NOT NULL,
	title 				VARCHAR(150) NOT NULL,
	listing_dsc	 		TEXT,
	listing_location	VARCHAR(100),
	wish				TEXT,
	created_at 			TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at 			TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id),
    FOREIGN KEY (category_id)
        REFERENCES categories(id),
    FOREIGN KEY (condition_id)
        REFERENCES conditions(id),
    FOREIGN KEY (state_id)
        REFERENCES listings_states(id)
);

CREATE TABLE images (
	id 				INT AUTO_INCREMENT PRIMARY KEY,
	listing_id 		INT NOT NULL,
	image_path		VARCHAR(150) NOT NULL,
	is_primary		BOOLEAN NOT NULL DEFAULT FALSE,

	FOREIGN KEY (listing_id)
		REFERENCES listings(id)
);

-- Aqui guardamos as negociacoes
CREATE TABLE trades (
	id 						INT AUTO_INCREMENT PRIMARY KEY,
	listing_requested_id	INT NOT NULL,
	sender_id 				INT NOT NULL,
	listing_offered_id		INT,
	trade_state_id			INT NOT NULL,
	initial_msg				VARCHAR(250) NOT NULL,
	created_at 				TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at	 			TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

	FOREIGN KEY (listing_requested_id)
		REFERENCES listings(id),
	FOREIGN KEY (sender_id)
		REFERENCES users(id),
	FOREIGN KEY (listing_offered_id)
		REFERENCES listings(id),
	FOREIGN KEY (trade_state_id)
    	REFERENCES trade_states(id)
);

--  Aqui guardam-se os registros do chat
CREATE TABLE messages (
	id 				INT AUTO_INCREMENT PRIMARY KEY,
	trade_id		INT NOT NULL,
	msg_sender		INT NOT NULL,
	msg				VARCHAR(250) NOT NULL,
	created_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (trade_id)
        REFERENCES trades(id),
    FOREIGN KEY (msg_sender)
        REFERENCES users(id)
);

--  Questionavel (reclamacao depende de admin)
CREATE TABLE reports (
	id 						INT AUTO_INCREMENT PRIMARY KEY,
	reporter_id				INT NOT NULL,
	reported_listings_id	INT,
	reported_user_id		INT,
	reason					VARCHAR(250) NOT NULL,
	created_at 				TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (reporter_id)
        REFERENCES users(id),
    FOREIGN KEY (reported_user_id)
        REFERENCES users(id),
    FOREIGN KEY (reported_listings_id)
        REFERENCES listings(id)
);

CREATE TABLE favorites (
	user_id			INT NOT NULL,
	listing_id			INT NOT NULL,

	PRIMARY KEY (user_id, listing_id),
	FOREIGN KEY (user_id)
		REFERENCES users(id),
	FOREIGN KEY (listing_id)
		REFERENCES listings(id)
);
