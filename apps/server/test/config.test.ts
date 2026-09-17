import { describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/config.js';

const BASE_ENV = {
  SANITIZE_SECRET: 'sanitize-secret',
  INTERNAL_MEDIA_SECRET: 'internal-secret',
};

describe('loadServerConfig', () => {
  it('applies the bounded cache defaults', () => {
    expect(loadServerConfig(BASE_ENV)).toMatchObject({
      host: '127.0.0.1',
      trustedProxyIps: [],
      port: 3000,
      internalMediaPort: 3001,
      internalMediaHost: '127.0.0.1',
      internalMediaSecret: 'internal-secret',
      mediaCacheMaxBytes: 5 * 1024 * 1024 * 1024,
      mediaCacheLowWatermarkBytes: 4 * 1024 * 1024 * 1024,
      mediaCacheTtlSeconds: 86400,
      mediaCacheSweepIntervalSeconds: 300,
      mediaFetchConcurrency: 2,
      mediaDownloadTimeoutMs: 120000,
      mediaRequestsPerMinute: 120,
      mediaRequestBurst: 20,
      mediaBandwidthBytesPerSecond: 8 * 1024 * 1024,
      mediaBandwidthBurstBytes: 16 * 1024 * 1024,
    });
  });

  it('requires both public sanitization and internal origin secrets', () => {
    expect(() => loadServerConfig({ ...BASE_ENV, SANITIZE_SECRET: '' })).toThrow(
      'SANITIZE_SECRET',
    );
    expect(() => loadServerConfig({ ...BASE_ENV, INTERNAL_MEDIA_SECRET: '' })).toThrow(
      'INTERNAL_MEDIA_SECRET',
    );
  });

  it('accepts only explicit proxy IP addresses', () => {
    expect(loadServerConfig({ ...BASE_ENV, TRUSTED_PROXY_IPS: ' 127.0.0.1, ::1 ' }).trustedProxyIps)
      .toEqual(['127.0.0.1', '::1']);
    expect(loadServerConfig({ ...BASE_ENV, TRUSTED_PROXY_IPS: ' ' }).trustedProxyIps).toEqual([]);
    for (const value of ['true', '*', 'proxy.local', '172.18.0.0/16', '127.0.0.1,']) {
      expect(() => loadServerConfig({ ...BASE_ENV, TRUSTED_PROXY_IPS: value }))
        .toThrow('TRUSTED_PROXY_IPS');
    }
  });

  it('rejects an invalid cache watermark', () => {
    expect(() =>
      loadServerConfig({
        ...BASE_ENV,
        MEDIA_CACHE_MAX_BYTES: '100',
        MEDIA_CACHE_LOW_WATERMARK_BYTES: '100',
      }),
    ).toThrow('MEDIA_CACHE_LOW_WATERMARK_BYTES');
  });

  it('only exposes the server when HOST is explicitly overridden', () => {
    expect(loadServerConfig({ ...BASE_ENV, HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
  });

  it('normalizes the public origin used by share previews', () => {
    expect(
      loadServerConfig({ ...BASE_ENV, PUBLIC_ORIGIN: 'https://shares.example.com///' })
        .publicOrigin,
    ).toBe('https://shares.example.com');
  });

  it('accepts a separate media origin host for container networking', () => {
    expect(
      loadServerConfig({ ...BASE_ENV, INTERNAL_MEDIA_HOST: 'bot' }).internalMediaHost,
    ).toBe('bot');
  });
});
