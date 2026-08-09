CREATE DATABASE daka;
USE daka;

CREATE TABLE users (
	id 				INT AUTO_INCREMENT PRIMARY KEY,
	username 		VARCHAR(100) NOT NULL,
	email 			VARCHAR(255) NOT NULL UNIQUE,
	pass_hash 		VARCHAR(255) NOT NULL,
	avatar 			VARCHAR(255),
	user_location 	VARCHAR(100),
	created_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		ON UPDATE CURRENT_TIMESTAMP
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

CREATE TABLE item_states
(
    id 				INT AUTO_INCREMENT PRIMARY KEY,
    state_name 		VARCHAR(50) NOT NULL
);

CREATE TABLE offer_states
(
    id 				INT AUTO_INCREMENT PRIMARY KEY,
    state_name 		VARCHAR(50) NOT NULL
);

CREATE TABLE items (
	id 				INT AUTO_INCREMENT PRIMARY KEY,
	user_id 		INT NOT NULL,
	category_id 	INT NOT NULL,
	condition_id 	INT NOT NULL,
	state_id 		INT NOT NULL,
	title 			VARCHAR(150) NOT NULL,
	item_dsc	 	TEXT,
	item_location	VARCHAR(100),
	created_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id),
    FOREIGN KEY (category_id)
        REFERENCES categories(id),
    FOREIGN KEY (condition_id)
        REFERENCES conditions(id),
    FOREIGN KEY (state_id)
        REFERENCES item_states(id)
);

CREATE TABLE images (
	id 				INT AUTO_INCREMENT PRIMARY KEY,
	item_id 		INT NOT NULL,
	image_path		VARCHAR(150) NOT NULL,
	is_primary		BOOLEAN NOT NULL DEFAULT FALSE,

	FOREIGN KEY (item_id)
		REFERENCES items(id)
);

CREATE TABLE offers (
	id 					INT AUTO_INCREMENT PRIMARY KEY,
	item_requested_id	INT NOT NULL,
	sender_id 			INT NOT NULL,
	offered_item_id		INT,
	offer_state_id		INT NOT NULL,
	initial_msg			VARCHAR(250) NOT NULL,
	created_at 			TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at	 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

	FOREIGN KEY (item_requested_id)
		REFERENCES items(id),
	FOREIGN KEY (sender_id)
		REFERENCES users(id),
	FOREIGN KEY (offered_item_id)
		REFERENCES items(id),
	FOREIGN KEY (offer_state_id)
    	REFERENCES offer_states(id)
);

--  aqui guardam-se os registros do chat
CREATE TABLE messages (
	id 				INT AUTO_INCREMENT PRIMARY KEY,
	offer_id		INT NOT NULL,
	msg_sender		INT NOT NULL,
	msg				VARCHAR(250) NOT NULL,
	created_at 		TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (offer_id)
        REFERENCES offers(id),
    FOREIGN KEY (msg_sender)
        REFERENCES users(id)
);

--  questionavel (reclamacao depende de admin)
CREATE TABLE reports (
	id 					INT AUTO_INCREMENT PRIMARY KEY,
	reporter_id			INT NOT NULL,
	reported_item_id	INT,
	reported_user_id	INT,
	reason				VARCHAR(250) NOT NULL,
	created_at 			TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (reporter_id)
        REFERENCES users(id),
    FOREIGN KEY (reported_user_id)
        REFERENCES users(id),
    FOREIGN KEY (reported_item_id)
        REFERENCES items(id)
);

CREATE TABLE favorites (
	user_id			INT NOT NULL,
	item_id			INT NOT NULL,

	PRIMARY KEY (user_id, item_id),
	FOREIGN KEY (user_id)
		REFERENCES users(id),
	FOREIGN KEY (item_id)
		REFERENCES items(id)
);
