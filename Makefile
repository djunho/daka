NAME    = daka
COMPOSE = docker compose -f srcs/docker-compose.yml

PROM_IMG = prom/prometheus:v3.1.0
AM_IMG   = prom/alertmanager:v0.28.0

all: up

secrets:
	bash srcs/tools/gen-secrets.sh srcs/.env

up: secrets
	$(COMPOSE) up -d --build

build:
	$(COMPOSE) build

down:
	$(COMPOSE) down

stop:
	$(COMPOSE) stop

start:
	$(COMPOSE) start

rebuild:
	$(COMPOSE) down
	$(COMPOSE) up -d --build

logs:
	$(COMPOSE) logs -f

status:
	$(COMPOSE) ps

validate: secrets
	$(COMPOSE) config -q && echo "compose config: OK"
	docker run --rm -v $(CURDIR)/srcs/requirements/observability/prometheus:/etc/prometheus:ro $(PROM_IMG) \
		promtool check config /etc/prometheus/prometheus.yml
	docker run --rm -v $(CURDIR)/srcs/requirements/observability/prometheus:/etc/prometheus:ro $(PROM_IMG) \
		promtool check rules /etc/prometheus/rules/alerts.yml
	docker run --rm -v $(CURDIR)/srcs/requirements/observability/alertmanager:/etc/alertmanager:ro $(AM_IMG) \
		amtool check-config /etc/alertmanager/alertmanager.yml
	@echo "validate: all config OK"

clean:
	$(COMPOSE) down -v

fclean:
	$(COMPOSE) down -v --rmi local

re: fclean all

sh-back:
	$(COMPOSE) exec backend bash

sh-front:
	$(COMPOSE) exec frontend sh

db:
	$(COMPOSE) exec db mariadb -u root -p

.PHONY: all secrets up build down stop start rebuild logs status validate clean fclean re sh-back sh-front db
