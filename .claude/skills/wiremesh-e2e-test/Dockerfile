FROM alpine:latest
RUN apk add --no-cache wireguard-tools curl iptables
COPY xray /usr/local/bin/xray
RUN chmod +x /usr/local/bin/xray
