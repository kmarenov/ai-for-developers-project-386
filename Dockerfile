# syntax=docker/dockerfile:1

# ---- Frontend build -------------------------------------------------------
FROM node:24-bookworm-slim AS frontend

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate

WORKDIR /app

# Install workspace dependencies first so the layer is cached until the
# lockfile or any package manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
COPY spec/package.json spec/package.json
RUN pnpm install --frozen-lockfile

COPY frontend/ frontend/
# VITE_API_BASE_URL stays unset, so the client calls the API through the same
# origin and nginx proxies the request to the Go backend.
RUN pnpm --dir frontend build

# ---- Backend build --------------------------------------------------------
FROM golang:1.26-bookworm AS backend

WORKDIR /src
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- Runtime --------------------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        gettext-base \
        nginx \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=frontend /app/frontend/dist /usr/share/nginx/html
COPY --from=backend /out/server /app/server

RUN chmod +x /usr/local/bin/entrypoint.sh

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
