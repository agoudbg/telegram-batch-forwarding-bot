// HTTP server configuration, loaded from environment variables. See
// .env.example and docs/PLAN.md, Phase 3.

import { isIP } from 'node:net';

export interface ServerConfig {
  /** Exact socket peer addresses allowed to supply a client IP header. */
  trustedProxyIps: string[];
  /** Base directory holding tbfb.db and media/ (shared with the bot) */
  dataDir: string;
  /** Interface exposed by the public HTTP server. Defaults to loopback. */
  host: string;
  port: number;
  /** Public origin used for canonical and social preview URLs. */
  publicOrigin?: string;
  /** Server-side secret keying the per-share fake-id HMAC. Combined with the
   *  share id it forms the sanitizer's shareSecret, so fake ids cannot be
   *  recomputed offline from a leaked share id (docs/PLAN.md §2.6). */
  sanitizeSecret: string;
  /** Bot username (without @) building the `get_<shareId>_<seq>` document
   *  fallback links (docs/PLAN.md §2.5); undefined disables the button */
  botUsername?: string;
  internalMediaPort: number;
  /** Hostname or address of the private bot media origin. */
  internalMediaHost: string;
  internalMediaSecret: string;
  mediaWebMaxBytes: number;
  mediaCacheEnabled: boolean;
  mediaCacheMaxBytes: number;
  mediaCacheLowWatermarkBytes: number;
  mediaCacheTtlSeconds: number;
  mediaCacheSweepIntervalSeconds: number;
  mediaFetchConcurrency: number;
  mediaDownloadTimeoutMs: number;
  mediaRequestsPerMinute: number;
  mediaRequestBurst: number;
  mediaBandwidthBytesPerSecond: number;
  mediaBandwidthBurstBytes: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_INTERNAL_MEDIA_PORT = 3001;
const DEFAULT_WEB_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_CACHE_LOW_WATERMARK_BYTES = 4 * 1024 * 1024 * 1024;

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got ${raw}`);
  }
  return value;
}

function booleanFlag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`Environment variable ${name} must be a boolean, got ${raw}`);
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const trustedProxyIps = env.TRUSTED_PROXY_IPS?.trim()
    ? env.TRUSTED_PROXY_IPS.split(',').map((address) => address.trim())
    : [];
  if (trustedProxyIps.some((address) => isIP(address) === 0)) {
    throw new Error('TRUSTED_PROXY_IPS must be a comma-separated list of IP addresses');
  }
  const sanitizeSecret = env.SANITIZE_SECRET;
  if (sanitizeSecret === undefined || sanitizeSecret === '') {
    throw new Error('Missing required environment variable SANITIZE_SECRET (see .env.example)');
  }
  const portValue = env.PORT;
  const port = portValue === undefined || portValue === '' ? DEFAULT_PORT : Number(portValue);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Environment variable PORT must be a valid port number, got ${portValue}`);
  }
  const mediaWebMaxBytes = positiveInt(
    env,
    'MEDIA_WEB_MAX_BYTES',
    DEFAULT_WEB_MEDIA_MAX_BYTES,
  );
  const mediaCacheMaxBytes = positiveInt(env, 'MEDIA_CACHE_MAX_BYTES', DEFAULT_CACHE_MAX_BYTES);
  if (mediaWebMaxBytes > mediaCacheMaxBytes) {
    throw new Error('MEDIA_WEB_MAX_BYTES must not exceed MEDIA_CACHE_MAX_BYTES');
  }
  const mediaCacheLowWatermarkBytes = positiveInt(
    env,
    'MEDIA_CACHE_LOW_WATERMARK_BYTES',
    DEFAULT_CACHE_LOW_WATERMARK_BYTES,
  );
  if (mediaCacheLowWatermarkBytes >= mediaCacheMaxBytes) {
    throw new Error('MEDIA_CACHE_LOW_WATERMARK_BYTES must be lower than MEDIA_CACHE_MAX_BYTES');
  }
  return {
    trustedProxyIps,
    dataDir: env.DATA_DIR || './data',
    host: env.HOST || '127.0.0.1',
    port,
    publicOrigin: env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') || undefined,
    sanitizeSecret,
    botUsername: env.BOT_USERNAME?.replace(/^@/, '') || undefined,
    internalMediaPort: positiveInt(env, 'INTERNAL_MEDIA_PORT', DEFAULT_INTERNAL_MEDIA_PORT),
    internalMediaHost: env.INTERNAL_MEDIA_HOST || '127.0.0.1',
    internalMediaSecret:
      env.INTERNAL_MEDIA_SECRET === undefined || env.INTERNAL_MEDIA_SECRET === ''
        ? (() => {
            throw new Error('Missing required environment variable INTERNAL_MEDIA_SECRET');
          })()
        : env.INTERNAL_MEDIA_SECRET,
    mediaWebMaxBytes,
    mediaCacheEnabled: booleanFlag(env, 'MEDIA_CACHE_ENABLED', true),
    mediaCacheMaxBytes,
    mediaCacheLowWatermarkBytes,
    mediaCacheTtlSeconds: positiveInt(env, 'MEDIA_CACHE_TTL_SECONDS', 86400),
    mediaCacheSweepIntervalSeconds: positiveInt(env, 'MEDIA_CACHE_SWEEP_INTERVAL_SECONDS', 300),
    mediaFetchConcurrency: positiveInt(env, 'MEDIA_FETCH_CONCURRENCY', 2),
    mediaDownloadTimeoutMs: positiveInt(env, 'MEDIA_DOWNLOAD_TIMEOUT_MS', 120_000),
    mediaRequestsPerMinute: positiveInt(env, 'MEDIA_REQUESTS_PER_MINUTE', 120),
    mediaRequestBurst: positiveInt(env, 'MEDIA_REQUEST_BURST', 20),
    mediaBandwidthBytesPerSecond: positiveInt(
      env,
      'MEDIA_BANDWIDTH_BYTES_PER_SECOND',
      8 * 1024 * 1024,
    ),
    mediaBandwidthBurstBytes: positiveInt(
      env,
      'MEDIA_BANDWIDTH_BURST_BYTES',
      16 * 1024 * 1024,
    ),
  };
}
