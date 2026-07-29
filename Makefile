NAME    = daka
COMPOSE = docker compose -f srcs/docker-compose.yml

all: up

# build (if needed) and start everything in the background
up:
	$(COMPOSE) up -d --build

build:
	$(COMPOSE) build

down:
	$(COMPOSE) down

stop:
	$(COMPOSE) stop

start:
	$(COMPOSE) start

# rebuild the images WITHOUT deleting the database
rebuild:
	$(COMPOSE) down
	$(COMPOSE) up -d --build

logs:
	$(COMPOSE) logs -f

status:
	$(COMPOSE) ps

# remove containers + volumes (DELETES THE DATABASE)
clean:
	$(COMPOSE) down -v

# like clean, but also removes THIS project's images.
fclean:
	$(COMPOSE) down -v --rmi local

re: fclean all

# --- day-to-day shortcuts ---

sh-back:
	$(COMPOSE) exec backend bash

sh-front:
	$(COMPOSE) exec frontend sh

# MariaDB client inside the container
db:
	$(COMPOSE) exec db mariadb -u root -p

.PHONY: all up build down stop start rebuild logs status clean fclean re sh-back sh-front db
