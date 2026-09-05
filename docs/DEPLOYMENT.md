# Deployment

This project uses a direct source deployment. The Node.js server serves the
built share frontend, API and media from one port. `pnpm start` starts the
server and bot together.

## Requirements

- Node.js 24.11 or newer
- pnpm 10 and npm 11
- Git and the native build tools required by `better-sqlite3`
- Telegram credentials described in the root `README.md`

No service manager or separate web server is required. The default listener is
`127.0.0.1:3000`. Set `HOST=0.0.0.0` in `.env` when the process must accept
connections from other machines. `PORT` changes the listener port.

## First setup

Run these commands from the repository root:

```bash
git clone --recurse-submodules <repository-url> telegram-batch-forwarding-bot
cd telegram-batch-forwarding-bot
cp .env.example .env
```

Edit `.env` and set at least `API_ID`, `API_HASH`, `BOT_TOKEN`,
`PUBLIC_ORIGIN`, `SANITIZE_SECRET` and `BOT_USERNAME`. Keep `PUBLIC_ORIGIN`
equal to the address used to open the share page. It is embedded into the web
build, so rebuild after changing it.

Install and build the project:

```bash
pnpm install
npm --prefix apps/web ci
pnpm build:deploy
```

The root workspace uses pnpm. The `apps/web` submodule keeps its own npm lock
file and is installed separately.

## Run

```bash
pnpm start
```

The command starts both Node.js processes and forwards their logs to the same
terminal. Press `Ctrl+C` to stop them.

Check the HTTP server from another terminal:

```bash
curl --fail http://127.0.0.1:3000/healthz
```

Open a share at `http://127.0.0.1:3000/s/<shareId>`. The root path is also
available for Telegram Mini App links. `deploy/start-app.mjs` creates the
internal bot/server secret automatically when `INTERNAL_MEDIA_SECRET` is
empty.

## Update

Stop the running process with `Ctrl+C`, then rebuild after pulling changes:

```bash
git pull --ff-only
git submodule update --init --recursive
pnpm install
npm --prefix apps/web ci
pnpm build:deploy
pnpm start
```

SQLite, the media cache and the Telegram session are kept under `DATA_DIR`,
which defaults to the project-local `./data` directory.
