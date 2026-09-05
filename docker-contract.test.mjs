import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const dockerfile = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
const compose = readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8');
const dockerignore = readFileSync(new URL('./.dockerignore', import.meta.url), 'utf8');

test('builds one pinned non-root runtime image without the supervisor script', () => {
  assert.match(dockerfile, /FROM node@sha256:|FROM node:[^\s]+@sha256:/);
  assert.match(dockerfile, /AS build/);
  assert.match(dockerfile, /AS runtime/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends git/);
  assert.match(dockerfile, /GIT_TERMINAL_PROMPT=0/);
  assert.match(dockerfile, /url\."https:\/\/github\.com\/"\.insteadOf/);
  assert.match(dockerfile, /apps\/server\/dist\/main\.js/);
  assert.doesNotMatch(dockerfile, /start-app\.mjs/);
});

test('runs server and bot as independent Compose services', () => {
  assert.match(compose, /services:\s+server:/);
  assert.match(compose, /\n {2}bot:/);
  assert.match(compose, /"node", "apps\/server\/dist\/main\.js"/);
  assert.match(compose, /"node", "apps\/bot\/dist\/main\.js"/);
  assert.match(compose, /INTERNAL_MEDIA_HOST: bot/);
  assert.match(compose, /INTERNAL_MEDIA_HOST: 0\.0\.0\.0/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /127\.0\.0\.1:\$\{TBFB_PORT:-3000\}:3000/);
  assert.doesNotMatch(compose, /(^|[^0-9])80:|443/);
  assert.match(compose, /source: \.\/data/);
  assert.match(compose, /create_host_path: false/);
  assert.match(compose, /healthz/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:/);
  assert.doesNotMatch(compose, /start-app\.mjs/);
});

test('keeps credentials, data and generated output out of the build context', () => {
  for (const entry of ['.env', 'data', 'node_modules', 'dist']) {
    assert.match(dockerignore, new RegExp(`(^|\\n)${entry.replace('.', '\\.')}(\\n|$)`));
  }
  assert.match(dockerignore, /\*\*\/\.git/);
  assert.match(dockerignore, /\*\*\/node_modules/);
  assert.match(dockerignore, /!apps\/web\/src\/hooks\/data\/\*\*/);
  assert.match(dockerignore, /!apps\/web\/src\/util\/data\/\*\*/);
});
