// Private Telegram media origin. The public HTTP server never receives
// Telegram credentials; it authenticates here and streams one registered
// media object into its bounded cache.

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';

import bigInt from 'big-integer';
import { Api, TelegramClient } from 'teleproto';

import type { MediaCacheVariant, MediaSourceRow, StorageDatabase } from '@tbfb/server';
import {
  getCustomEmojiDocument,
  getMedia,
  listMediaSources,
  updateMediaReference,
  upsertMediaSource,
} from '@tbfb/server';
import { mediaKeyFor } from './media.js';

export interface MediaOriginOptions {
  db: StorageDatabase;
  client: TelegramClient;
  port: number;
  host?: string;
  secret: string;
  log?: (line: string) => void;
}

export function startMediaOrigin(options: MediaOriginOptions): Promise<Server> {
  const server = createServer((request, response) => {
    void handleRequest(options, request.url, request.headers.authorization, response).catch(
      (error: unknown) => {
        options.log?.(`media origin failure: ${String(error)}`);
        if (!response.headersSent) {
          response.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5' });
          response.end(JSON.stringify({ error: 'telegram_unavailable' }));
        } else {
          response.destroy(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function handleRequest(
  options: MediaOriginOptions,
  rawUrl: string | undefined,
  authorization: string | undefined,
  response: ServerResponse,
): Promise<void> {
  if (!isAuthorized(authorization, options.secret)) {
    response.writeHead(401).end();
    return;
  }

  const url = new URL(rawUrl ?? '/', 'http://127.0.0.1');
  const match = /^\/internal\/media\/([^/]+)$/.exec(url.pathname);
  const variant = url.searchParams.get('variant');
  if (match === null || !isVariant(variant)) {
    response.writeHead(404).end();
    return;
  }

  const mediaKey = decodeURIComponent(match[1]!);
  const media = getMedia(options.db, mediaKey);
  if (media === null) {
    response.writeHead(404).end();
    return;
  }

  const sources = listMediaSources(options.db, mediaKey);
  if (variant === 'avatar') {
    const source = sources.find((candidate) => candidate.kind === 'avatar');
    if (source === undefined) {
      response.writeHead(404).end();
      return;
    }
    const entity = await options.client.getEntity(avatarPeerInput(source));
    if (Array.isArray(entity)) {
      response.writeHead(404).end();
      return;
    }
    const bytes = await options.client.downloadProfilePhoto(entity);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.length),
    });
    response.end(bytes);
    return;
  }

  const customEmoji = getCustomEmojiDocument(options.db, mediaKey);
  if (customEmoji !== null) {
    await streamCustomEmoji(options, customEmoji.documentId, media, variant, response);
    return;
  }

  const located = await findSourceMessage(options, mediaKey, sources);
  if (located === null) {
    response.writeHead(404).end();
    return;
  }

  const thumb = variant === 'thumb' ? thumbnailIndex(located.message) : undefined;
  if (variant === 'thumb' && thumb === null) {
    response.writeHead(404).end();
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': media.mime ?? 'application/octet-stream',
  };
  if (variant === 'thumb') {
    const bytes = await options.client.downloadMedia(located.message, { thumb: thumb! });
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      response.writeHead(404).end();
      return;
    }
    headers['Content-Type'] = sniffImageMime(bytes);
    headers['Content-Length'] = String(bytes.length);
    response.writeHead(200, headers);
    response.end(bytes);
    return;
  }
  response.writeHead(200, headers);
  await options.client.downloadMedia(located.message, {
    outputFile: response,
  });
  if (!response.writableEnded) response.end();
}

async function streamCustomEmoji(
  options: MediaOriginOptions,
  documentId: string,
  media: NonNullable<ReturnType<typeof getMedia>>,
  variant: MediaCacheVariant,
  response: ServerResponse,
): Promise<void> {
  const result = await options.client.invoke(
    new Api.messages.GetCustomEmojiDocuments({ documentId: [bigInt(documentId)] }),
  );
  const document = result.find(
    (candidate): candidate is Api.Document => candidate instanceof Api.Document,
  );
  if (document === undefined) {
    response.writeHead(404).end();
    return;
  }

  const mediaDocument = new Api.MessageMediaDocument({ document });
  if (variant === 'thumb') {
    const thumbnail = thumbnailIndexForDocument(document);
    if (thumbnail === null) {
      response.writeHead(404).end();
      return;
    }
    const bytes = await options.client.downloadMedia(mediaDocument, { thumb: thumbnail });
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': sniffImageMime(bytes),
      'Content-Length': String(bytes.length),
    });
    response.end(bytes);
    return;
  }

  response.writeHead(200, { 'Content-Type': media.mime ?? 'application/octet-stream' });
  await options.client.downloadMedia(mediaDocument, { outputFile: response });
  if (!response.writableEnded) response.end();
}

function avatarPeerInput(source: MediaSourceRow) {
  const reference = parseAvatarReference(source.reference);
  if (reference === null) return source.sourcePeerId;

  const id = bigInt(reference.peerId);
  if (reference.kind === 'user') return new Api.PeerUser({ userId: id });
  if (reference.kind === 'chat') return new Api.PeerChat({ chatId: id });
  return new Api.PeerChannel({ channelId: id });
}

function parseAvatarReference(
  json: string | null,
): { peerId: string; kind: 'user' | 'chat' | 'channel' } | null {
  if (json === null) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.peerId !== 'string'
      || (candidate.kind !== 'user' && candidate.kind !== 'chat' && candidate.kind !== 'channel')
    ) {
      return null;
    }
    return { peerId: candidate.peerId, kind: candidate.kind };
  } catch {
    return null;
  }
}

async function findSourceMessage(
  options: MediaOriginOptions,
  mediaKey: string,
  sources: MediaSourceRow[],
): Promise<{ message: Api.Message; source: MediaSourceRow } | null> {
  for (const source of sources) {
    if (source.kind === 'avatar' || source.sourceMessageId <= 0) continue;
    const result = await options.client.invoke(
      new Api.messages.GetMessages({
        id: [new Api.InputMessageID({ id: source.sourceMessageId })],
      }),
    );
    if (!('messages' in result)) continue;
    const message = result.messages.find(
      (candidate: Api.TypeMessage): candidate is Api.Message =>
        candidate instanceof Api.Message && mediaId(candidate) === mediaKey,
    );
    if (message === undefined) continue;
    const reference = referenceFromMessage(message);
    const serializedReference = reference === null ? source.reference : JSON.stringify(reference);
    upsertMediaSource(options.db, {
      ...source,
      reference: serializedReference,
    });
    if (source.kind === 'document' && reference !== null) {
      updateMediaReference(options.db, mediaKey, JSON.stringify(reference));
    }
    return { message, source };
  }
  return null;
}

function mediaId(message: Api.Message): string | null {
  const media = message.media;
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    return mediaKeyFor('document', media.document.id.toString());
  }
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    return mediaKeyFor('photo', media.photo.id.toString());
  }
  return null;
}

function referenceFromMessage(message: Api.Message): Record<string, unknown> | null {
  const media = message.media;
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    return {
      id: media.document.id.toString(),
      accessHash: media.document.accessHash.toString(),
      fileReference: Buffer.from(media.document.fileReference).toString('base64'),
      hasThumbnail: (media.document.thumbs?.length ?? 0) > 0,
    };
  }
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    return {
      id: media.photo.id.toString(),
      accessHash: media.photo.accessHash.toString(),
      fileReference: Buffer.from(media.photo.fileReference).toString('base64'),
      hasThumbnail: (media.photo.sizes?.length ?? 0) >= 2,
    };
  }
  return null;
}

function thumbnailIndex(message: Api.Message): number | null {
  const media = message.media;
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const count = media.document.thumbs?.length ?? 0;
    return count === 0 ? null : count - 1;
  }
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const count = media.photo.sizes?.length ?? 0;
    return count < 2 ? null : Math.min(1, count - 1);
  }
  return null;
}

function thumbnailIndexForDocument(document: Api.Document): number | null {
  const count = document.thumbs?.length ?? 0;
  return count === 0 ? null : count - 1;
}

function isAuthorized(header: string | undefined, secret: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isVariant(value: string | null): value is MediaCacheVariant {
  return value === 'full' || value === 'thumb' || value === 'avatar';
}

function sniffImageMime(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return 'application/octet-stream';
}
