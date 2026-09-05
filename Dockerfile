FROM node:24.11-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57 AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV GIT_TERMINAL_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global npm@11.12.1 --no-audit --no-fund

RUN git config --global url."https://github.com/".insteadOf "git@github.com:" \
    && git config --global --add url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global --add url."https://github.com/".insteadOf "git+ssh://git@github.com/"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/tlbridge/package.json packages/tlbridge/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package-lock.json apps/web/

RUN pnpm install --frozen-lockfile \
    && npm --prefix apps/web ci --install-strategy=nested --no-audit --no-fund

COPY packages/tlbridge packages/tlbridge
COPY apps/server apps/server
COPY apps/bot apps/bot
COPY apps/web apps/web

RUN pnpm build

ARG PUBLIC_ORIGIN
RUN BASE_URL="$PUBLIC_ORIGIN" npm --prefix apps/web run build:share

COPY .dockerignore Dockerfile docker-compose.yml eslint.config.js ./
COPY docker-contract.test.mjs ./docker-contract.test.mjs

FROM node:24.11-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57 AS runtime

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV SESSION_FILE=/data/session.txt
ENV PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build --chown=node:node /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build --chown=node:node /app/apps/bot/dist ./apps/bot/dist
COPY --from=build --chown=node:node /app/packages/tlbridge/package.json ./packages/tlbridge/package.json
COPY --from=build --chown=node:node /app/packages/tlbridge/dist ./packages/tlbridge/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist

USER node

EXPOSE 3000

CMD ["node", "apps/server/dist/main.js"]
