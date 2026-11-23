import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, extractCaption, fetchInstagramCaption } from '../src/instagram.js';
import { fakeFetch } from './helpers.js';

const EMBED = `<html><body><div class="Embed"><div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/some.chef/" target="_blank">some.chef</a><br />Tomato &amp; egg stir-fry for two!<br />4 eggs, 3 tomatoes, 1 tsp sugar<br />Beat the eggs, fry, set aside. Cook tomatoes 3 min.<div class="CaptionComments"><a href="#">View all 12 comments</a></div></div></div></body></html>`;

const JSON_PAGE = `<html><script>window.__d={"shortcode_media":{"edge_media_to_caption":{"edges":[{"node":{"text":"Garlic noodles \\u2014 for 2\\n200 g noodles, 4 cloves garlic, 2 tbsp soy sauce"}}]}}}</script></html>`;

const META_PAGE = `<html><head><meta property="og:description" content="1,234 likes, 56 comments - some.chef on May 1, 2025: &quot;Crispy smashed potatoes. Boil 20 min, smash, roast at 220C for 30 min with olive oil and salt.&quot;." /></head></html>`;

const LOGIN_WALL = '<html><head><title>Login • Instagram</title></head><body>Log in to continue</body></html>';

const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

test('decodeEntities handles named, decimal and hex entities in one pass', () => {
  assert.equal(decodeEntities('Fish &amp; chips &lt;3 &#39;tasty&#39; &#x1F600; &nbsp;ok'), "Fish & chips <3 'tasty' 😀  ok");
  assert.equal(decodeEntities('&amp;lt;'), '&lt;'); // not decoded twice
  assert.equal(decodeEntities('&unknown; &#99999999999;'), '&unknown; ');
});

test('caption is read from the embed page and the "view comments" tail is dropped', () => {
  const text = extractCaption(EMBED);
  assert.ok(text.startsWith('Tomato & egg stir-fry for two!'));
  assert.ok(text.includes('4 eggs, 3 tomatoes, 1 tsp sugar'));
  assert.ok(!text.includes('View all'));
  assert.ok(!text.includes('some.chef'));
  assert.ok(!text.includes('<'));
});

test('caption is read from embedded page data, including escapes', () => {
  const text = extractCaption(JSON_PAGE);
  assert.equal(text, 'Garlic noodles — for 2\n200 g noodles, 4 cloves garlic, 2 tbsp soy sauce');
});

test('caption is read from the preview tag as a last resort', () => {
  const text = extractCaption(META_PAGE);
  assert.equal(text, 'Crispy smashed potatoes. Boil 20 min, smash, roast at 220C for 30 min with olive oil and salt.');
});

test('a login wall or an empty page gives no caption', () => {
  assert.equal(extractCaption(LOGIN_WALL), null);
  assert.equal(extractCaption(''), null);
  assert.equal(extractCaption('<div class="Caption"><a class="CaptionUsername">x</a></div>'), null);
});

const parsed = {
  ok: true,
  platform: 'instagram',
  kind: 'reel',
  id: 'C9xAbCdEfGh',
  canonicalUrl: 'https://www.instagram.com/reel/C9xAbCdEfGh/',
};

test('the embed address is tried first and sent like an ordinary browser visit', async () => {
  const f = fakeFetch(() => html(EMBED));
  const out = await fetchInstagramCaption(parsed, { fetchImpl: f });
  assert.equal(out.source, 'embed');
  assert.ok(out.text.includes('Tomato & egg'));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://www.instagram.com/reel/C9xAbCdEfGh/embed/captioned/');
  assert.match(f.calls[0].init.headers['user-agent'], /Mozilla/);
  assert.equal(f.calls[0].init.headers.cookie, undefined, 'we never send cookies or log in');
});

test('when the embed address fails the normal page is tried', async () => {
  const f = fakeFetch((call) => (call.url.includes('/embed/') ? html('nope', 404) : html(META_PAGE)));
  const out = await fetchInstagramCaption(parsed, { fetchImpl: f });
  assert.equal(out.source, 'page');
  assert.ok(out.text.startsWith('Crispy smashed potatoes'));
  assert.equal(f.calls.length, 2);
});

test('when both fail we get nothing and no error', async () => {
  const f = fakeFetch(() => html(LOGIN_WALL));
  assert.deepEqual(await fetchInstagramCaption(parsed, { fetchImpl: f }), { text: null, source: null });
  const g = fakeFetch(() => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual(await fetchInstagramCaption(parsed, { fetchImpl: g }), { text: null, source: null });
});

test('a share link is first resolved to the real reel address', async () => {
  const share = { ...parsed, kind: 'share', id: 'BAhNxYz123', canonicalUrl: 'https://www.instagram.com/share/reel/BAhNxYz123/' };
  const f = fakeFetch((call) => {
    if (call.url.includes('/share/')) {
      return { ok: true, status: 200, url: 'https://www.instagram.com/reel/RealCode123/?utm=x', body: null, text: async () => '' };
    }
    return html(EMBED);
  });
  const out = await fetchInstagramCaption(share, { fetchImpl: f });
  assert.equal(out.source, 'embed');
  assert.equal(f.calls[1].url, 'https://www.instagram.com/reel/RealCode123/embed/captioned/');
});

test('a share link that cannot be resolved gives nothing', async () => {
  const share = { ...parsed, kind: 'share', id: 'BAhNxYz123', canonicalUrl: 'https://www.instagram.com/share/reel/BAhNxYz123/' };
  const f = fakeFetch(() => ({ ok: true, status: 200, url: 'https://www.instagram.com/accounts/login/', body: null, text: async () => '' }));
  assert.deepEqual(await fetchInstagramCaption(share, { fetchImpl: f }), { text: null, source: null });
});
