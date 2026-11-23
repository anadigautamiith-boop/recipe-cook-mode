// Link parsing, shared by the browser and the Worker.
// Pure functions only: no DOM, no network. Anything we later fetch is built from the
// parsed id, never from the raw text a visitor typed.

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const IG_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
  'www.instagr.am',
]);
const OTHER_SITES = [
  { match: /(^|\.)tiktok\.com$/, name: 'TikTok' },
  { match: /(^|\.)facebook\.com$|(^|\.)fb\.watch$|(^|\.)fb\.com$/, name: 'Facebook' },
  { match: /(^|\.)x\.com$|(^|\.)twitter\.com$/, name: 'X' },
  { match: /(^|\.)vimeo\.com$/, name: 'Vimeo' },
];
const YT_ID_PREFIX = /^[A-Za-z0-9_-]{11}/;
const IG_CODE = /^[A-Za-z0-9_-]{5,40}$/;

const COPY_HINT = 'Open the video, tap Share, then Copy link.';

function bad(code, message, hint = null) {
  return { ok: false, code, message, hint };
}

function youtube(rawId) {
  const m = String(rawId ?? '').match(YT_ID_PREFIX);
  if (!m) {
    return bad('bad_url', "We couldn't find a video in that YouTube link.", COPY_HINT);
  }
  const id = m[0];
  return {
    ok: true,
    platform: 'youtube',
    kind: 'video',
    id,
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}

/**
 * Turn whatever the visitor pasted into a clean, canonical description of the video.
 * Success: { ok: true, platform: 'youtube' | 'instagram', kind, id, canonicalUrl }
 * Failure: { ok: false, code, message, hint }
 */
export function parseVideoUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return bad('bad_url', 'Paste a link to a YouTube video or an Instagram Reel.');
  }
  if (raw.length > 600) {
    return bad('bad_url', 'That link is too long to be a video link.', COPY_HINT);
  }

  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return bad('bad_url', "That doesn't look like a link.", COPY_HINT);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return bad('bad_url', "That doesn't look like a web link.", COPY_HINT);
  }

  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  // ---- YouTube -------------------------------------------------------------
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return youtube(parts[0]);
  }
  if (YT_HOSTS.has(host)) {
    const first = parts[0];
    if (first === 'watch') return youtube(u.searchParams.get('v'));
    if (['shorts', 'embed', 'live', 'v'].includes(first)) return youtube(parts[1]);
    if (first === 'playlist') {
      return bad('bad_url', 'That is a playlist link.', 'Open one video and copy its link instead.');
    }
    if (first === 'channel' || first === 'c' || first === 'user' || (first && first.startsWith('@'))) {
      return bad('bad_url', 'That is a channel link, not a single video.', 'Open the video and copy its link.');
    }
    return bad('bad_url', "We couldn't find a video in that YouTube link.", COPY_HINT);
  }

  // ---- Instagram -----------------------------------------------------------
  if (IG_HOSTS.has(host)) {
    // New-style share links: /share/reel/CODE, /share/p/CODE or /share/CODE
    if (parts[0] === 'share') {
      const code = parts[parts.length - 1];
      if (parts.length >= 2 && IG_CODE.test(code) && !['reel', 'p', 'share'].includes(code)) {
        const middle = parts.length === 3 && ['reel', 'p'].includes(parts[1]) ? `${parts[1]}/` : '';
        return {
          ok: true,
          platform: 'instagram',
          kind: 'share',
          id: code,
          canonicalUrl: `https://www.instagram.com/share/${middle}${code}/`,
        };
      }
      return bad('bad_url', "We couldn't read that Instagram share link.", COPY_HINT);
    }

    const i = parts.findIndex((p) => ['reel', 'reels', 'p', 'tv'].includes(p));
    if (i >= 0 && parts[i + 1] && IG_CODE.test(parts[i + 1])) {
      const kind = parts[i] === 'reels' ? 'reel' : parts[i];
      const id = parts[i + 1];
      return {
        ok: true,
        platform: 'instagram',
        kind,
        id,
        canonicalUrl: `https://www.instagram.com/${kind}/${id}/`,
      };
    }
    if (parts[0] === 'reels') {
      return bad('bad_url', "That's the Reels feed, not one reel.", 'Open the reel, tap Share, then Copy link.');
    }
    if (parts[0] === 'stories') {
      return bad('bad_url', "Instagram Stories aren't supported.", 'Try a Reel or a post with a video.');
    }
    return bad('bad_url', "We couldn't find a reel in that Instagram link.", 'Open the reel, tap Share, then Copy link.');
  }

  // ---- Everything else -------------------------------------------------------
  const other = OTHER_SITES.find((o) => o.match.test(host));
  if (other) {
    return bad('unsupported_site', `${other.name} links aren't supported yet.`, 'Try a YouTube video or an Instagram Reel.');
  }
  return bad('unsupported_site', 'We can only read YouTube and Instagram links right now.', 'Paste a YouTube video or an Instagram Reel link.');
}

/** A short label used in the interface. */
export function platformLabel(platform) {
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'instagram') return 'Instagram';
  return 'Pasted text';
}

/** Link that opens the original video at a given second (YouTube only). */
export function youtubeLinkAt(id, seconds) {
  const t = Number.isFinite(seconds) && seconds > 0 ? `&t=${Math.floor(seconds)}s` : '';
  return `https://www.youtube.com/watch?v=${id}${t}`;
}
