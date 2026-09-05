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
  await writeFile(path.join(webRoot, 'index.html'), '<html><body>share app</body></html>');
  await writeFile(path.join(webRoot, 'assets', 'app.js'), 'console.log("share app");');
  db = openDatabase(':memory:');
  app = createServerApp({
    db,
    sanitizeSecret: 'test-secret',
    dataDir: webRoot,
    webRoot,
  });
});

afterAll(async () => {
  db.close();
  await rm(webRoot, { recursive: true, force: true });
});

describe('built web routes', () => {
  it('serves the index at the root and share routes', async () => {
    const root = await app.request('/');
    expect(root.status).toBe(200);
    await expect(root.text()).resolves.toContain('share app');

    const share = await app.request('/s/share-a');
    expect(share.status).toBe(200);
    expect(share.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    await expect(share.text()).resolves.toContain('share app');
  });

  it('serves built assets without using the share fallback', async () => {
    const asset = await app.request('/assets/app.js');
    expect(asset.status).toBe(200);
    await expect(asset.text()).resolves.toContain('share app');

    const missing = await app.request('/missing');
    expect(missing.status).toBe(404);
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
