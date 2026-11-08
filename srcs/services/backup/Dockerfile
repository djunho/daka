ARG MARIADB_IMAGE=mariadb:11
FROM ${MARIADB_IMAGE}

RUN apt-get update \
    && apt-get install -y --no-install-recommends cron util-linux \
    && rm -rf /var/lib/apt/lists/*
COPY --chmod=0755 backup.sh start-cron.sh /usr/local/bin/
COPY --chmod=0644 crontab /etc/cron.d/daka-backup

ENTRYPOINT []
CMD ["/usr/local/bin/start-cron.sh"]
