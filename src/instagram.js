// Best-effort reading of a public Instagram post's caption.
//
// We only read what Instagram serves publicly to any visitor (the embed page that
// third-party sites use, and the page's preview tags). We never log in, use cookies or
// work around blocks. If Instagram refuses, the visitor is asked to paste the text.
//
// Everything here uses plain string searching rather than heavy regular expressions,
// because a Worker on the free plan has a very small CPU budget per request.

import { parseVideoUrl } from '../public/js/shared/urls.js';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAX_BYTES = 350_000;

function codePoint(cp) {
  try {
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  } catch {
    return '';
  }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Turn &amp; &#39; &#x1F600; and friends back into characters, in a single pass. */
export function decodeEntities(str) {
  return String(str).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const e = entity.toLowerCase();
    if (e.startsWith('#x')) return codePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return codePoint(parseInt(e.slice(1), 10));
    return Object.hasOwn(NAMED, e) ? NAMED[e] : match;
  });
}

// Read a JSON string literal that starts at `from` (just after the opening quote).
function readJsonString(html, from) {
  let i = from;
  let out = '';
  while (i < html.length && out.length < 10_000) {
    const ch = html[i];
    if (ch === '\\') {
      out += html.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  try {
    return JSON.parse(`"${out}"`);
  } catch {
    return null;
  }
}

function captionFromJson(html) {
  for (const marker of ['"edge_media_to_caption"', '"caption":{']) {
    const at = html.indexOf(marker);
    if (at < 0) continue;
    const t = html.indexOf('"text":"', at);
    if (t < 0 || t - at > 600) continue;
    const value = readJsonString(html, t + 8);
    if (value && value.trim().length >= 20) return value.trim();
  }
  return null;
}

function captionFromEmbedDiv(html) {
  const at = html.indexOf('class="Caption"');
  if (at < 0) return null;
  const start = html.indexOf('>', at);
  const end = html.indexOf('</div>', start);
  if (start < 0 || end < 0) return null;
  let chunk = html.slice(start + 1, end);
  const nameStart = chunk.indexOf('<a');
  const nameEnd = chunk.indexOf('</a>');
  if (nameStart === 0 && nameEnd > 0 && chunk.slice(0, nameEnd).includes('CaptionUsername')) {
    chunk = chunk.slice(nameEnd + 4);
  }
  chunk = chunk.split('<br').join('\n<br').replace(/<br\s*\/?>/gi, '').replace(/<[^>]+>/g, '');
  chunk = decodeEntities(chunk).replace(/ /g, ' ').trim();
  const comments = chunk.search(/\n?\s*View all [\d,.]+[KkMm]? comments?/);
  if (comments >= 0) chunk = chunk.slice(0, comments).trim();
  return chunk.length >= 20 ? chunk : null;
}

function metaContent(html, name) {
  const at = html.indexOf(name);
  if (at < 0) return null;
  const tagStart = html.lastIndexOf('<meta', at);
  const tagEnd = html.indexOf('>', at);
  if (tagStart < 0 || tagEnd < 0 || tagEnd - tagStart > 6000) return null;
  const tag = html.slice(tagStart, tagEnd);
  const c = tag.indexOf('content=');
  if (c < 0) return null;
  const quote = tag[c + 8];
  if (quote !== '"' && quote !== "'") return null;
  const close = tag.indexOf(quote, c + 9);
  if (close < 0) return null;
  return decodeEntities(tag.slice(c + 9, close));
}

function captionFromMeta(html) {
  const description = metaContent(html, 'og:description') || metaContent(html, 'name="description"');
  if (!description) return null;
  // Instagram previews look like:  12 likes, 3 comments - user on May 1, 2025: "The caption..."
  const open = description.search(/:\s*["“]/);
  if (open >= 0) {
    let text = description.slice(open).replace(/^:\s*["“]/, '');
    text = text.replace(/["”]\.?\s*$/, '');
    if (text.trim().length >= 20) return text.trim();
  }
  return description.trim().length >= 60 ? description.trim() : null;
}

/** Pull the caption out of an Instagram page or embed page. Returns text or null. */
export function extractCaption(html) {
  const found = [captionFromJson(html), captionFromEmbedDiv(html), captionFromMeta(html)].filter(Boolean);
  if (found.length === 0) return null;
  found.sort((a, b) => b.length - a.length);
  return found[0];
}

async function readLimited(res, maxBytes = MAX_BYTES) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    return (await res.text()).slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      break;
    }
  }
  return out;
}

async function getHtml(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return { html: '', finalUrl: res.url || url };
    return { html: await readLimited(res), finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try to read the public caption of an Instagram post.
 * Always resolves: { text: string | null, source: 'embed' | 'page' | null }.
 */
export async function fetchInstagramCaption(parsed, { fetchImpl, timeoutMs = 8000 } = {}) {
  let { kind, id } = parsed;
  try {
    if (kind === 'share') {
      const { finalUrl } = await getHtml(fetchImpl, parsed.canonicalUrl, timeoutMs);
      const again = parseVideoUrl(finalUrl);
      if (!again.ok || again.platform !== 'instagram' || again.kind === 'share') {
        return { text: null, source: null };
      }
      kind = again.kind;
      id = again.id;
    }
  } catch {
    return { text: null, source: null };
  }

  const attempts = [
    { url: `https://www.instagram.com/${kind}/${id}/embed/captioned/`, source: 'embed' },
    { url: `https://www.instagram.com/${kind}/${id}/`, source: 'page' },
  ];
  for (const attempt of attempts) {
    try {
      const { html } = await getHtml(fetchImpl, attempt.url, timeoutMs);
      const text = html ? extractCaption(html) : null;
      if (text) return { text, source: attempt.source };
    } catch {
      // try the next address
    }
  }
  return { text: null, source: null };
}
