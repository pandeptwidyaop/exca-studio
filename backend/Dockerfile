FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source + embedded frontend (web/)
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /exca-studio .

# ── Runtime ──────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /exca-studio /usr/local/bin/exca-studio

# PocketBase data directory
VOLUME /data

EXPOSE 8092

ENTRYPOINT ["exca-studio", "serve", "--http=0.0.0.0:8092", "--dir=/data"]
