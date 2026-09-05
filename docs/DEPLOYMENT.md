# Deployment

The recommended deployment uses Docker Compose. The root `Dockerfile` builds
the backend and share frontend from source. Compose runs the HTTP server and
Telegram bot as separate services that share the project-local `./data`
directory.

## Docker deployment

### Requirements

- Linux or WSL with Docker Engine and Docker Compose v2
- Git with the `apps/web` submodule initialized
- A public HTTPS hostname when deploying outside local development
- Telegram credentials described in the root `README.md`

The current Windows development host is not the Docker validation target. Use
native Linux or WSL for image builds and runtime checks.

### First setup

Clone the repository with its WebA submodule:

```bash
git clone --recurse-submodules <repository-url> telegram-batch-forwarding-bot
cd telegram-batch-forwarding-bot
cp .env.example .env
mkdir -p data
```

Set at least these values in `.env`:

```dotenv
API_ID=123456
API_HASH=replace-me
BOT_TOKEN=replace-me
PUBLIC_ORIGIN=https://shares.example.com
SANITIZE_SECRET=replace-with-a-stable-random-secret
BOT_USERNAME=example_bot
INTERNAL_MEDIA_SECRET=replace-with-an-independent-random-secret
TBFB_PORT=3000
```

Keep `SANITIZE_SECRET` stable. Changing it changes the share-scoped fake ids
for existing shares. `INTERNAL_MEDIA_SECRET` must be the same for the server
and bot services. Generate both secrets independently with a local secret
generator such as `openssl rand -hex 32`.

The container defaults to UID/GID `1000:1000`. On Linux or WSL, make the data
directory writable by that identity when necessary:

```bash
sudo chown -R 1000:1000 data
```

### Build and start

Run these commands from the repository root:

```bash
docker compose config
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/healthz
```

The server serves the WebA share frontend, API and media from port `3000`.
The bot's authenticated media origin listens on the private Compose network at
`bot:3001`; it is not published on the host.

The host reverse proxy should forward the public hostname to
`http://127.0.0.1:3000`. Docker does not own ports 80 or 443 and does not
manage TLS certificates. Keep the Docker port loopback-only.

### Trusted proxy client addresses

Before exposing the service through the host reverse proxy, set
`TRUSTED_PROXY_IPS` in `.env` to the exact proxy socket address seen by the
server. Otherwise all proxied visitors share one media request and bandwidth
allowance. The default empty value ignores forwarding headers.

For the Linux Docker bridge deployment above, host connections normally appear
as the bridge gateway. Inspect its address after starting the containers:

```bash
docker inspect --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$(docker compose ps -q server)"
```

For example, if that returns `172.18.0.1`, set
`TRUSTED_PROXY_IPS=172.18.0.1`. Recheck after recreating the Compose network;
do not trust the whole container subnet. For source mode with a local reverse
proxy, use `TRUSTED_PROXY_IPS=127.0.0.1,::1`. Alternate network arrangements
must use the actual socket peer address instead of assuming the gateway.

Configure the trusted edge proxy to **overwrite** `X-Forwarded-For` with one
validated client IP. For an Nginx edge directly receiving visitor connections,
the relevant location directives are:

```nginx
proxy_pass http://127.0.0.1:3000;
proxy_set_header X-Forwarded-For $remote_addr;
```

Do not append with `$proxy_add_x_forwarded_for`. Comma-separated chains,
invalid addresses and headers from untrusted peers fall back to the socket
address. If a CDN or another proxy sits in front of the edge, configure that
edge's trusted upstream IP handling first so it emits a validated visitor IP.
Apply `.env` changes with `docker compose up -d --force-recreate server`
(restart `pnpm start` in source mode).

Verify that two visitors opening different shares have separate client limits,
and that changing forwarding headers on a direct, untrusted connection cannot
bypass throttling. Per-share limits still apply across all visitors.

### Operations

```bash
docker compose logs -f server bot
docker compose restart server bot
docker compose down
```

`docker compose down` removes containers and the default network, but it does
not remove the `./data` bind mount. Do not use `docker compose down -v` as a
backup strategy; SQLite, the Telegram session and the media cache all live in
the host directory and should be backed up independently.

When updating source:

```bash
git pull --ff-only
git submodule update --init --recursive
docker compose up -d --build
curl --fail http://127.0.0.1:3000/healthz
```

Changing `PUBLIC_ORIGIN` or any frontend build configuration requires the
`--build` command. Changing runtime secrets only requires container
recreation, for example `docker compose up -d --force-recreate`.

### Troubleshooting

- If Compose reports that `PUBLIC_ORIGIN` is missing, configure `.env` before
  building. It is a build-time frontend value.
- If the container cannot write SQLite or session files, fix ownership of
  `./data` or set `TBFB_UID` and `TBFB_GID` to the host directory owner.
- If the server is healthy but media requests fail, verify that
  `INTERNAL_MEDIA_SECRET` is non-empty and identical for both services.
- If the bot exits during startup, inspect `docker compose logs bot`; Telegram
  credentials and the session belong to the bot service.

## Source deployment

Docker is optional. The existing source workflow keeps the server and bot in
one local process tree managed by `deploy/start-app.mjs`:

```bash
cp .env.example .env
pnpm install
npm --prefix apps/web ci --install-strategy=nested
pnpm build:deploy
pnpm start
```

The source workflow uses `DATA_DIR=./data` and listens on `127.0.0.1:3000` by
default. Press `Ctrl+C` to stop it. This workflow does not use Docker files or
the Compose network.
