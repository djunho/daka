FROM nginx:1.27-alpine

RUN apk add --no-cache openssl && \
    mkdir -p /etc/nginx/certs && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/nginx/certs/self.key \
      -out /etc/nginx/certs/self.crt \
      -subj "/C=PT/ST=Dev/L=Dev/O=Daka/CN=localhost"

COPY conf/default.conf /etc/nginx/conf.d/default.conf
