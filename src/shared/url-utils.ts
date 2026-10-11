export type UrlNormalizationResult = {
  normalizedUrl: string;
  originalUrl: string;
};

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function isAllowedUrl(url: string | URL): boolean {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : new URL(url.toString());
    return ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

export function normalizeUrl(rawUrl: string, baseUrl: string): string | null {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const resolved = new URL(trimmed, baseUrl);

    if (!ALLOWED_PROTOCOLS.has(resolved.protocol.toLowerCase())) {
      return null;
    }

    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
}

export function stripFragment(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

export function dedupeUrls(urls: readonly string[]): string[] {
  const deduped = new Set<string>();

  for (const url of urls) {
    const candidate = normalizeUrl(url, 'https://example.invalid');
    const key = candidate ? stripFragment(candidate) : stripFragment(url);

    if (!key) {
      continue;
    }

    deduped.add(key);
  }

  return Array.from(deduped);
}

export function getBestSrcsetCandidate(srcset: string): string | null {
  const parts = srcset.split(',');

  if (parts.length === 0) {
    return null;
  }

  let bestCandidate: { url: string; score: number } | null = null;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    const url = tokens[0];

    if (!url) {
      continue;
    }

    const descriptor = tokens[1]?.toLowerCase() ?? '';
    const numericMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
    const numericValue = numericMatch ? Number(numericMatch[1]) : 0;

    if (numericValue > (bestCandidate?.score ?? Number.NEGATIVE_INFINITY)) {
      bestCandidate = { url, score: numericValue };
    }

    if (!bestCandidate && url) {
      bestCandidate = { url, score: 1 };
    }
  }

  return bestCandidate?.url ?? null;
}

export function getFileExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([A-Za-z0-9]+)(?:$|[?#])/u);
    return match ? match[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

export function sanitizeFileName(fileName: string, fallback = 'download'): string {
  const base = fileName.trim() || fallback;
  const decoded = globalThis.decodeURIComponent(base).replace(INVALID_FILENAME_CHARS, '_');
  const cleaned = decoded.replace(/\.+/gu, '.').replace(/\s+/gu, ' ').trim();
  const withoutDotDot = cleaned.replace(/\.{2,}/gu, '.');
  const safe = withoutDotDot.length > 150 ? withoutDotDot.slice(0, 150) : withoutDotDot;

  return safe === '' ? fallback : safe;
}

export function getBaseNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = globalThis.decodeURIComponent(parsed.pathname).split('/').filter(Boolean).pop();
    return pathname && pathname.trim() ? pathname : 'download';
  } catch {
    return 'download';
  }
}
