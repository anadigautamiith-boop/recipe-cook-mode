import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoUrl, platformLabel, youtubeLinkAt } from '../public/js/shared/urls.js';

const ID = 'dQw4w9WgXcQ';
const YT_CANON = `https://www.youtube.com/watch?v=${ID}`;

test('YouTube links in every common shape give the same canonical link', () => {
  const inputs = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}&feature=share`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abcdef`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `youtube.com/watch?v=${ID}`,
    `  https://www.youtube.com/watch?v=${ID}  `,
    `http://www.youtube.com/watch?v=${ID}`,
  ];
  for (const input of inputs) {
    const out = parseVideoUrl(input);
    assert.equal(out.ok, true, input);
    assert.equal(out.platform, 'youtube', input);
    assert.equal(out.id, ID, input);
    assert.equal(out.canonicalUrl, YT_CANON, input);
  }
});

test('Instagram reels, posts and share links are recognised', () => {
  const reel = parseVideoUrl('https://www.instagram.com/reel/C9xAbCdEfGh/?igsh=abc');
  assert.deepEqual(
    { ok: reel.ok, platform: reel.platform, kind: reel.kind, id: reel.id, url: reel.canonicalUrl },
    { ok: true, platform: 'instagram', kind: 'reel', id: 'C9xAbCdEfGh', url: 'https://www.instagram.com/reel/C9xAbCdEfGh/' },
  );

  const reels = parseVideoUrl('https://www.instagram.com/reels/C9xAbCdEfGh/');
  assert.equal(reels.kind, 'reel');
  assert.equal(reels.canonicalUrl, 'https://www.instagram.com/reel/C9xAbCdEfGh/');

  const withUser = parseVideoUrl('https://www.instagram.com/some.chef/reel/C9xAbCdEfGh/');
  assert.equal(withUser.ok, true);
  assert.equal(withUser.id, 'C9xAbCdEfGh');

  const post = parseVideoUrl('https://instagram.com/p/C9xAbCdEfGh');
  assert.equal(post.kind, 'p');

  const share = parseVideoUrl('https://www.instagram.com/share/reel/BAhNxYz123/');
  assert.equal(share.ok, true);
  assert.equal(share.kind, 'share');
  assert.equal(share.canonicalUrl, 'https://www.instagram.com/share/reel/BAhNxYz123/');
});

test('links that are not a single supported video are refused with a plain reason', () => {
  const cases = [
    ['', 'bad_url'],
    ['   ', 'bad_url'],
    ['hello world', 'bad_url'],
    ['https://www.youtube.com/playlist?list=PL123', 'bad_url'],
    ['https://www.youtube.com/@somechannel', 'bad_url'],
    ['https://www.youtube.com/', 'bad_url'],
    ['https://www.youtube.com/watch?v=short', 'bad_url'],
    ['https://www.instagram.com/stories/someone/123/', 'bad_url'],
    ['https://www.instagram.com/reels/', 'bad_url'],
    ['https://www.instagram.com/some.chef/', 'bad_url'],
    ['https://www.tiktok.com/@a/video/123', 'unsupported_site'],
    ['https://vimeo.com/123456', 'unsupported_site'],
    ['https://example.com/recipe', 'unsupported_site'],
    ['ftp://example.com/a', 'bad_url'],
    ['javascript:alert(1)', 'bad_url'],
  ];
  for (const [input, code] of cases) {
    const out = parseVideoUrl(input);
    assert.equal(out.ok, false, `"${input}" should be refused`);
    assert.equal(out.code, code, `"${input}" code`);
    assert.ok(out.message && out.message.length > 5, `"${input}" has a message`);
  }
});

test('absurdly long input is refused instead of parsed', () => {
  const out = parseVideoUrl(`https://www.youtube.com/watch?v=${ID}&x=${'a'.repeat(900)}`);
  assert.equal(out.ok, false);
});

test('look-alike hosts are not mistaken for YouTube', () => {
  for (const input of [
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evilyoutube.com/watch?v=${ID}`,
    `https://www.youtube.com@evil.example/watch?v=${ID}`,
  ]) {
    const out = parseVideoUrl(input);
    assert.equal(out.ok, false, input);
  }
});

test('labels and timestamp links', () => {
  assert.equal(platformLabel('youtube'), 'YouTube');
  assert.equal(platformLabel('instagram'), 'Instagram');
  assert.equal(platformLabel('text'), 'Pasted text');
  assert.equal(youtubeLinkAt(ID, 95.7), `${YT_CANON}&t=95s`);
  assert.equal(youtubeLinkAt(ID, 0), YT_CANON);
  assert.equal(youtubeLinkAt(ID, null), YT_CANON);
});
