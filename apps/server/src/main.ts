// HTTP entry point: share data API + media streaming, serving from the same
// DATA_DIR (SQLite + media files) the bot writes to (docs/PLAN.md, Phase 3).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

import { createServerApp } from './api/app.js';
import { loadServerConfig } from './config.js';
import { openDatabase } from './storage/database.js';
import { HttpMediaOriginClient, MediaCache } from './mediaCache.js';
import { MediaRequestGovernor } from './mediaGovernor.js';

/** Load the first .env found walking up from the cwd. */
function loadEnvFile(): void {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function main(): void {
  loadEnvFile();
  const config = loadServerConfig();
  const db = openDatabase(path.join(config.dataDir, 'tbfb.db'));
  const mediaOrigin = new HttpMediaOriginClient(
    config.internalMediaPort,
    config.internalMediaSecret,
    config.internalMediaHost,
  );
  const mediaCache = config.mediaCacheEnabled
    ? new MediaCache({
        db,
        dataDir: config.dataDir,
        origin: mediaOrigin,
        maxBytes: config.mediaCacheMaxBytes,
        maxMediaBytes: config.mediaCacheMaxFileBytes,
        lowWatermarkBytes: config.mediaCacheLowWatermarkBytes,
        ttlSeconds: config.mediaCacheTtlSeconds,
        sweepIntervalSeconds: config.mediaCacheSweepIntervalSeconds,
        maxConcurrentFetches: config.mediaFetchConcurrency,
        downloadTimeoutMs: config.mediaDownloadTimeoutMs,
        log: (line) => console.error(`[media-cache] ${line}`),
      })
    : undefined;
  const mediaGovernor = new MediaRequestGovernor({
    requestsPerMinute: config.mediaRequestsPerMinute,
    requestBurst: config.mediaRequestBurst,
    bandwidthBytesPerSecond: config.mediaBandwidthBytesPerSecond,
    bandwidthBurstBytes: config.mediaBandwidthBurstBytes,
  });
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  const webIndexPath = path.join(webRoot, 'index.html');
  if (!existsSync(webIndexPath)) {
    console.warn(
      `Web build not found at ${webIndexPath}; run pnpm build:deploy before serving pages.`,
    );
  }
  const app = createServerApp({
    db,
    sanitizeSecret: config.sanitizeSecret,
    dataDir: config.dataDir,
    botUsername: config.botUsername,
    publicOrigin: config.publicOrigin,
    mediaCache,
    mediaOrigin,
    maxHostedMediaBytes: config.mediaWebMaxBytes,
    maxCacheFileBytes: config.mediaCacheMaxFileBytes,
    mediaDownloadTimeoutMs: config.mediaDownloadTimeoutMs,
    mediaGovernor,
    trustedProxyIps: config.trustedProxyIps,
    webRoot: existsSync(webIndexPath) ? webRoot : undefined,
  });

  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(
      `Share server listening on ${config.host}:${info.port} (data dir: ${config.dataDir})`,
    );
  });
}

main();
