import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const makefile = readFileSync(new URL('./Makefile', import.meta.url), 'utf8');

test('exposes safe setup, verification and Compose operations', () => {
  assert.match(makefile, /^\.DEFAULT_GOAL := help$/m);
  assert.match(makefile, /git submodule update --init --recursive/);
  assert.match(makefile, /git-status:/);
  assert.match(makefile, /git-diff:/);
  assert.match(makefile, /git-log:/);
  assert.match(makefile, /LIMIT \?= 20/);
  assert.match(makefile, /git-update:\r?\n\t@if test -n/);
  assert.match(makefile, /git pull --ff-only/);
  assert.match(makefile, /verify:\r?\n(?:\t.*\r?\n){4}/);
  assert.match(makefile, /docker-up:\r?\n\t\$\(COMPOSE\) up -d --build/);
  assert.match(makefile, /docker-down:\r?\n\t\$\(COMPOSE\) down/);
  assert.match(makefile, /docker-logs:\r?\n\t\$\(COMPOSE\) logs -f \$\(SERVICE\)/);
  assert.match(makefile, /HEALTH_URL \?= http:\/\/127\.0\.0\.1:3000\/healthz/);
  assert.doesNotMatch(makefile, /\bdown\s+-v\b/);
});

test('keeps generated localization separate from the web verification gate', () => {
  assert.match(makefile, /web-localization:\r?\n\t\$\(NPM\).*run lang:share-legacy/);
  const verificationBlock =
    makefile.match(/web-verify:\r?\n([\s\S]*?)(?=\r?\n\r?\n[^ \t].*:\r?\n|$)/)?.[1] ?? '';
  assert.doesNotMatch(verificationBlock, /lang:share-legacy/);
});
