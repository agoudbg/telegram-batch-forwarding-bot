import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServerApp } from '../src/api/app.js';
import { openDatabase } from '../src/storage/database.js';
import type { StorageDatabase } from '../src/storage/database.js';

let webRoot!: string;
let db!: StorageDatabase;
let app!: ReturnType<typeof createServerApp>;

beforeAll(async () => {
  webRoot = await mkdtemp(path.join(tmpdir(), 'tbfb-web-'));
  await mkdir(path.join(webRoot, 'assets'));
  await writeFile(
    path.join(webRoot, 'index.html'),
    '<html><head><title>Telegram Web</title>' +
      '<meta name="title" content="Telegram Web">' +
      '<meta name="description" content="Telegram Web description">' +
      '<meta name="robots" content="index, follow">' +
      '<meta name="application-name" content="Telegram Web">' +
      '<meta name="mobile-web-app-title" content="Telegram Web">' +
      '<meta name="apple-mobile-web-app-title" content="Telegram Web">' +
      '<meta property="og:title" content="Original Telegram Web preview">' +
      '<meta name="twitter:description" content="Original preview">' +
      '<meta property="og:image" content="https://web.telegram.org/icon.png">' +
      '<meta property="twitter:image" content="https://web.telegram.org/icon.png">' +
      '<link rel="canonical" href="https://web.telegram.org/k/">' +
      '</head><body><noscript><h1>Telegram Web</h1></noscript>share app</body></html>',
  );
  await writeFile(path.join(webRoot, 'assets', 'app.js'), 'console.log("share app");');
  db = openDatabase(':memory:');
  app = createServerApp({
    db,
    sanitizeSecret: 'test-secret',
    dataDir: webRoot,
    publicOrigin: 'https://shares.example.com',
    webRoot,
  });
});

afterAll(async () => {
  db.close();
  await rm(webRoot, { recursive: true, force: true });
});

describe('built web routes', () => {
  it('redirects the root to the project homepage and serves share routes', async () => {
    const root = await app.request('/');
    expect(root.status).toBe(302);
    expect(root.headers.get('Location')).toBe(
      'https://github.com/agoudbg/telegram-batch-forwarding-bot',
    );

    const share = await app.request(
      'http://127.0.0.1:3000/s/share-a?utm_source=telegram',
    );
    expect(share.status).toBe(200);
    expect(share.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    const shareHtml = await share.text();
    expect(shareHtml).toContain('share app');
    expect(shareHtml).toContain('<title>Shared Message</title>');
    expect(shareHtml).toContain('property="og:url" content="https://shares.example.com/s/share-a"');
    expect(shareHtml).toContain('rel="canonical" href="https://shares.example.com/s/share-a"');
    expect(shareHtml).toContain('name="twitter:card" content="summary"');
    expect(shareHtml).not.toContain('Telegram Web');
    expect(shareHtml).not.toContain('https://web.telegram.org/k/');

    const trailingSlash = await app.request(
      'http://127.0.0.1:3000/s/share-a/?utm_source=telegram',
    );
    expect(trailingSlash.status).toBe(200);
    await expect(trailingSlash.text()).resolves.not.toContain('Telegram Web');
  });

  it('serves built assets without using the share fallback', async () => {
    const asset = await app.request('/assets/app.js');
    expect(asset.status).toBe(200);
    await expect(asset.text()).resolves.toContain('share app');

    const missing = await app.request('/missing');
    expect(missing.status).toBe(302);
    expect(missing.headers.get('Location')).toBe(
      'https://github.com/agoudbg/telegram-batch-forwarding-bot',
    );
  });

  it('keeps API and media routes ahead of static files', async () => {
    const api = await app.request('/api/shares/missing');
    expect(api.status).toBe(404);
    await expect(api.json()).resolves.toEqual({ error: 'not_found' });

    const media = await app.request('/media/missing/key');
    expect(media.status).toBe(404);
    await expect(media.json()).resolves.toEqual({ error: 'not_found' });
  });
});
