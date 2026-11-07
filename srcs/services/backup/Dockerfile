FROM alpine:3.22

RUN apk add --no-cache mariadb mariadb-client flock
COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh
COPY --chmod=0600 crontab /etc/crontabs/root

CMD ["/usr/local/bin/backup.sh"]
