// Share-page metadata is rendered by the server so crawlers do not inherit
// metadata from the upstream Telegram Web application.

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const PREVIEW_TITLE = 'Shared Message';
const PREVIEW_DESCRIPTION =
  'A read-only collection of Telegram messages shared with Telegram Batch Forwarding Bot.';

const REMOVED_META_NAMES = new Set([
  'title',
  'description',
  'robots',
  'application-name',
  'mobile-web-app-title',
  'apple-mobile-web-app-title',
]);

function containsRemovedMetadata(tag: string): boolean {
  const names = Array.from(tag.matchAll(/\b(?:name|property)\s*=\s*(["'])(.*?)\1/gi), (match) =>
    match[2]!.trim().toLowerCase(),
  );
  return names.some(
    (name) => REMOVED_META_NAMES.has(name) || name.startsWith('og:') || name.startsWith('twitter:'),
  );
}

function isCanonicalLink(tag: string): boolean {
  const match = /\brel\s*=\s*(["'])(.*?)\1/i.exec(tag);
  return match?.[2].split(/\s+/).some((value) => value.toLowerCase() === 'canonical') ?? false;
}

function metadataBlock(shareUrl: string): string {
  const escapedUrl = escapeHtmlAttribute(shareUrl);
  const escapedTitle = escapeHtmlAttribute(PREVIEW_TITLE);
  const escapedDescription = escapeHtmlAttribute(PREVIEW_DESCRIPTION);

  return [
    `<title>${escapedTitle}</title>`,
    '<meta name="robots" content="noindex, nofollow">',
    `<meta name="description" content="${escapedDescription}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escapedTitle}">`,
    `<meta property="og:description" content="${escapedDescription}">`,
    `<meta property="og:url" content="${escapedUrl}">`,
    '<meta property="og:site_name" content="Telegram Batch Forwarding Bot">',
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${escapedTitle}">`,
    `<meta name="twitter:description" content="${escapedDescription}">`,
    `<link rel="canonical" href="${escapedUrl}">`,
  ].join('\n    ');
}

function buildShareUrl(requestUrl: string, publicOrigin?: string): string {
  const shareUrl = new URL(requestUrl);
  shareUrl.search = '';
  shareUrl.hash = '';
  shareUrl.username = '';
  shareUrl.password = '';

  if (publicOrigin !== undefined) {
    const configuredOrigin = new URL(publicOrigin);
    if (configuredOrigin.protocol !== 'http:' && configuredOrigin.protocol !== 'https:') {
      throw new Error('PUBLIC_ORIGIN must use the http or https protocol');
    }
    shareUrl.protocol = configuredOrigin.protocol;
    shareUrl.hostname = configuredOrigin.hostname;
    shareUrl.port = configuredOrigin.port;
  }

  return shareUrl.toString();
}

/**
 * Replace page metadata while preserving the built application's scripts and
 * markup. The input is a trusted build artifact, not user-provided HTML.
 */
export function renderSharePreviewHtml(
  template: string,
  requestUrl: string,
  publicOrigin?: string,
): string {
  const shareUrl = buildShareUrl(requestUrl, publicOrigin);

  const withoutUpstreamMetadata = template
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*>/gi, (tag) => (containsRemovedMetadata(tag) ? '' : tag))
    .replace(/<link\b[^>]*>/gi, (tag) => (isCanonicalLink(tag) ? '' : tag))
    .replace(/(<noscript\b[^>]*>[\s\S]*?<h1\b[^>]*>)[\s\S]*?(<\/h1>)/gi, `$1${PREVIEW_TITLE}$2`);
  const block = metadataBlock(shareUrl);

  if (/<\/head>/i.test(withoutUpstreamMetadata)) {
    return withoutUpstreamMetadata.replace(/<\/head>/i, `    ${block}\n  </head>`);
  }
  return `${block}\n${withoutUpstreamMetadata}`;
}
