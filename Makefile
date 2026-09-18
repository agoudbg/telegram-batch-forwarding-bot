.DEFAULT_GOAL := help

PNPM ?= pnpm
NPM ?= npm
DOCKER ?= docker
COMPOSE ?= $(DOCKER) compose
CURL ?= curl
HEALTH_URL ?= http://127.0.0.1:3000/healthz
SERVICE ?= server bot
LIMIT ?= 20
WEB_DIR := apps/web

.PHONY: help setup init git-submodule-init submodule-status git-status git-diff \
	git-log git-update deps root-deps web-deps data \
	build source-build source-start typecheck test lint format verify \
	web-localization web-check web-test web-build web-e2e web-verify web-dev-mocked \
	docker-config docker-build docker-up docker-ps docker-logs docker-restart \
	docker-recreate docker-down docker-gateway health

help:
	@printf '%s\n' \
		'Usage: make <target> [VARIABLE=value]' \
		'' \
		'Setup:' \
		'  setup             Initialize submodules, install dependencies and create data/' \
		'  init              Initialize all Git submodules' \
		'  git-status        Show root and recursive submodule status' \
		'  git-diff          Show staged/unstaged stats and whitespace errors' \
		'  git-log           Show recent commit graph (LIMIT=20)' \
		'  git-update        Fast-forward root and update submodules when clean' \
		'  submodule-status  Show recursive submodule status' \
		'  deps              Install root and apps/web dependencies' \
		'  data              Create the project-local data directory' \
		'' \
		'Quality gates:' \
		'  build             Build backend workspace packages' \
		'  typecheck         Run TypeScript checks' \
		'  test              Run root and package tests' \
		'  lint              Run ESLint' \
		'  format            Format the repository' \
		'  verify            Run build, typecheck, test and lint in order' \
		'' \
		'Source mode:' \
		'  source-build      Build backend and the share frontend' \
		'  source-start      Start the source-mode server and bot supervisor' \
		'' \
		'Web submodule:' \
		'  web-localization   Regenerate the tracked legacy localization file' \
		'  web-check         Run apps/web TypeScript checks' \
		'  web-test          Run apps/web unit tests' \
		'  web-build         Build the share frontend' \
		'  web-e2e           Run apps/web Playwright tests' \
		'  web-verify        Run the complete apps/web regression gate' \
		'  web-dev-mocked    Start the mocked share frontend dev server' \
		'' \
		'Docker Compose:' \
		'  docker-config     Validate the resolved Compose configuration' \
		'  docker-build      Build the local image' \
		'  docker-up         Build and start server and bot in the background' \
		'  docker-ps         Show Compose service status' \
		'  docker-logs       Follow logs (SERVICE=server bot)' \
		'  docker-restart    Restart services (SERVICE=server bot)' \
		'  docker-recreate   Recreate services after runtime config changes' \
		'  docker-down       Stop services and keep data/' \
		'  docker-gateway    Print the Docker bridge gateway for server' \
		'  health            Check the server health endpoint' \
		'' \
		'Examples:' \
		'  make docker-logs SERVICE=bot' \
		'  make health HEALTH_URL=http://127.0.0.1:3000/healthz'

setup: init data deps

init: git-submodule-init

git-submodule-init:
	git submodule update --init --recursive

submodule-status:
	git submodule status --recursive

git-status:
	git status --short --branch
	git submodule status --recursive

git-diff:
	git diff --stat
	git diff --cached --stat
	git diff --check
	git diff --cached --check

git-log:
	git log --oneline --decorate --graph -$(LIMIT)

git-update:
	@if test -n "$$(git status --porcelain --untracked-files=all)"; then \
		printf '%s\n' 'Working tree is not clean; run make git-status first.' >&2; \
		exit 1; \
	fi
	git pull --ff-only
	git submodule update --init --recursive

deps: root-deps web-deps

root-deps:
	$(PNPM) install --frozen-lockfile

web-deps:
	$(NPM) --prefix $(WEB_DIR) ci --install-strategy=nested

data:
	mkdir -p data

build:
	$(PNPM) build

source-build:
	$(PNPM) build:deploy

source-start:
	$(PNPM) start

typecheck:
	$(PNPM) typecheck

test:
	$(PNPM) test

lint:
	$(PNPM) lint

format:
	$(PNPM) format

verify:
	$(PNPM) build
	$(PNPM) typecheck
	$(PNPM) test
	$(PNPM) lint

web-check:
	$(NPM) --prefix $(WEB_DIR) run check:ts

web-localization:
	$(NPM) --prefix $(WEB_DIR) run lang:share-legacy

web-test:
	$(NPM) --prefix $(WEB_DIR) test

web-build:
	$(NPM) --prefix $(WEB_DIR) run build:share

web-e2e:
	$(NPM) --prefix $(WEB_DIR) run test:playwright

web-verify:
	$(NPM) --prefix $(WEB_DIR) run check:ts
	$(NPM) --prefix $(WEB_DIR) run check:css
	$(NPM) --prefix $(WEB_DIR) test
	$(NPM) --prefix $(WEB_DIR) run build:share
	$(NPM) --prefix $(WEB_DIR) run test:playwright

web-dev-mocked:
	$(NPM) --prefix $(WEB_DIR) run dev:mocked

docker-config:
	$(COMPOSE) config

docker-build:
	$(COMPOSE) build

docker-up:
	$(COMPOSE) up -d --build

docker-ps:
	$(COMPOSE) ps

docker-logs:
	$(COMPOSE) logs -f $(SERVICE)

docker-restart:
	$(COMPOSE) restart $(SERVICE)

docker-recreate:
	$(COMPOSE) up -d --force-recreate $(SERVICE)

docker-down:
	$(COMPOSE) down

docker-gateway:
	@container_id="$$( $(COMPOSE) ps -q server )"; \
	if [ -z "$$container_id" ]; then \
		printf '%s\n' 'Server container is not running.' >&2; \
		exit 1; \
	fi; \
	$(DOCKER) inspect --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$$container_id"

health:
	$(CURL) --fail --silent --show-error "$(HEALTH_URL)"
