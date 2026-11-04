INSERT INTO categories (category_name)
VALUES
	('Books'),
	('Clothing'),
	('Collectibles'),
	('Computers'),
	('Electronics'),
	('Games'),
	('Home'),
	('Music'),
	('Other'),
	('Sports'),
	('Tools'),
	('Toys');

INSERT INTO conditions (condition_name)
VALUES
	('New'),
	('Like New'),
	('Good'),
	('Fair'),
	('Needs Repair');

INSERT INTO listings_states (state_name)
VALUES
	('Available'),
	('Reserved'),
	('Traded'),
	('Expired'),
	('Removed');

INSERT INTO negotiation_states (state_name)
VALUES
	('Open'),
	('Agreed'),
	('Completed'),
	('Cancelled'),
	('Unavailable');

INSERT INTO proposal_states (state_name)
VALUES
	('Pending'),
	('Accepted'),
	('Rejected'),
	('Withdrawn'),
	('NotSelected'),
	('ItemUnavailable');

-- Add up to two symmetric friendships when users already exist. IDs are
-- ordered so each pair is stored only once.
-- The fresh database does not seed users, so this is intentionally a no-op
-- until at least two accounts have been created.
INSERT INTO friendships (user_id, friend_id, status)
SELECT first_user.id, second_user.id, 'accepted'
FROM users AS first_user
JOIN users AS second_user
	ON first_user.id < second_user.id
WHERE first_user.deleted_at IS NULL
	AND second_user.deleted_at IS NULL
ORDER BY first_user.id, second_user.id
LIMIT 2;
