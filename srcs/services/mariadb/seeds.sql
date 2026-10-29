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
