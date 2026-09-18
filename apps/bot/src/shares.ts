// Share creation helpers, deep-link payloads and send rate limiting
// (docs/PLAN.md, Phase 2 Commit 9; §2.5 document fallback).

import { randomBytes } from 'node:crypto';

const MAX_SHARE_ID_LENGTH = 32;
const MAX_DEEP_LINK_PAYLOAD_LENGTH = 64;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_LINK_PUNCTUATION = /[.,!?;:)\]}>'"]+$/;
const MAX_RATE_LIMIT_KEYS = 10_000;

/** Random unguessable share id (§2.8: share pages are public by default, so
 *  the id is the capability). 72 bits of entropy, URL-safe. */
export function createShareId(): string {
  return randomBytes(9).toString('base64url');
}

export interface ShareLinks {
  /** Public HTTPS page served by apps/web */
  webUrl: string;
  /** t.me direct link opening the Mini App (when configured) */
  directLink: string | null;
}

export function buildShareLinks(
  config: { publicOrigin: string; botUsername: string; miniAppShortName?: string },
  shareId: string,
): ShareLinks {
  return {
    webUrl: `${config.publicOrigin}/s/${shareId}`,
    directLink:
      config.miniAppShortName !== undefined
        ? `https://t.me/${config.botUsername}/${config.miniAppShortName}?startapp=${shareId}`
        : null,
  };
}

export function buildShareReply(
  links: ShareLinks,
  messageCount: number,
  media: { hosted: number; unhosted: number; failed: number },
): string {
  const lines = [
    `✅ Batch ready — ${messageCount} message${messageCount === 1 ? '' : 's'}.`,
    ``,
    `🔗 ${links.webUrl}`,
  ];
  if (links.directLink !== null) lines.push(`📱 ${links.directLink}`);
  if (media.failed > 0) {
    lines.push(`⚠️ ${media.failed} media registration${media.failed === 1 ? '' : 's'} failed.`);
  }
  return lines.join('\n');
}

/** Parse a `/start get_<shareId>_<seq>` deep-link payload (§2.5). */
export function parseGetPayload(payload: string): { shareId: string; seq: number } | null {
  const trimmed = payload.trim();
  if (trimmed.length > MAX_DEEP_LINK_PAYLOAD_LENGTH) return null;
  const match = /^get_(.+)_(\d+)$/.exec(trimmed);
  if (match === null) return null;
  const shareId = match[1]!;
  const seq = Number(match[2]);
  if (!isValidShareId(shareId) || !Number.isSafeInteger(seq) || seq < 0) return null;
  return { shareId, seq };
}

export function isValidShareId(shareId: string): boolean {
  return (
    shareId.length > 0 && shareId.length <= MAX_SHARE_ID_LENGTH && SHARE_ID_PATTERN.test(shareId)
  );
}

/** Extract a share id from a bare id, a public share URL or a Mini App link. */
export function extractShareId(input: string): string | null {
  const trimmed = input.trim();
  if (isValidShareId(trimmed)) return trimmed;

  const urls = input.match(URL_PATTERN) ?? [];
  for (const rawUrl of urls) {
    const candidate = rawUrl.replace(TRAILING_LINK_PUNCTUATION, '');
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    const shareMarkerIndex = pathParts.lastIndexOf('s');
    if (shareMarkerIndex === pathParts.length - 2) {
      const shareId = pathParts[pathParts.length - 1]!;
      if (isValidShareId(shareId)) return shareId;
    }

    const miniAppId = url.searchParams.get('startapp');
    if (miniAppId !== null && isValidShareId(miniAppId)) return miniAppId;
  }

  return null;
}

/** Per-key fixed-interval rate limiter (one action per interval per key). */
export class RateLimiter {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const current = this.now();
    for (const [trackedKey, timestamp] of this.last) {
      if (current - timestamp >= this.intervalMs) this.last.delete(trackedKey);
    }

    const previous = this.last.get(key);
    if (previous !== undefined && current - previous < this.intervalMs) return false;

    if (!this.last.has(key) && this.last.size >= MAX_RATE_LIMIT_KEYS) {
      const oldestKey = this.last.keys().next().value;
      if (oldestKey !== undefined) this.last.delete(oldestKey);
    }

    this.last.set(key, current);
    return true;
  }
}

/** FIFO queue serializing outbound sends so FloodWait absorption in one send
 *  does not interleave with the next (docs/PLAN.md §6). */
export class SendQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
