FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

# Binary is pre-built by CI and copied into context
COPY exca-studio /usr/local/bin/exca-studio
RUN chmod +x /usr/local/bin/exca-studio

# Embedded frontend (web/) is already in the binary via go:embed

VOLUME /data
EXPOSE 8092

ENTRYPOINT ["exca-studio", "serve", "--http=0.0.0.0:8092", "--dir=/data"]
