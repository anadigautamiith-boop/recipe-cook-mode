// Run the whole app on your own computer:  npm run dev   (real AI, needs .dev.vars)
//                                           npm run dev:mock   (pretend AI, no key, no cost)
// It serves ./public exactly like the Worker would, including the headers in public/_headers,
// so a page that breaks the security policy breaks here too.

import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../src/app.js';
import { createMockFetch } from './mock-network.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const MOCK = process.env.MOCK === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
};

/** Settings: wrangler.jsonc "vars", then .dev.vars, then (mock mode) a fake key. */
function loadEnv() {
  const env = {};
  try {
    const text = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    Object.assign(env, JSON.parse(text).vars || {});
  } catch (err) {
    console.warn('Could not read vars from wrangler.jsonc:', err.message);
  }
  const devVars = join(ROOT, '.dev.vars');
  if (existsSync(devVars)) {
    for (const line of readFileSync(devVars, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  if (MOCK) {
    env.OPENROUTER_API_KEY = 'mock-key';
    // Pretend runs cost nothing, so do not make the person trying the app wait for the limits.
    env.RATE_LIMIT_PER_HOUR = process.env.RATE_LIMIT_PER_HOUR || '1000';
    env.DAILY_CAP = process.env.DAILY_CAP || '10000';
  }
  return env;
}

/** A tiny reader for the public/_headers file (Cloudflare's format). */
function loadHeaderRules() {
  const file = join(PUBLIC, '_headers');
  if (!existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: {} };
      rules.push(current);
    } else if (current) {
      const i = raw.indexOf(':');
      if (i > 0) current.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return rules;
}

function matches(pattern, path) {
  if (pattern === '/*') return true;
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

const env = loadEnv();
const headerRules = loadHeaderRules();
const handle = createHandler({
  fetchImpl: MOCK ? createMockFetch({ delayMs: Number(process.env.MOCK_DELAY || 900) }) : undefined,
});

async function toRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const hasBody = !['GET', 'HEAD'].includes(req.method) && chunks.length > 0;
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  else if (!extname(rel)) rel = `${rel.replace(/\/$/, '')}.html`;
  const file = normalize(join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (rel === '/_headers') {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const data = await readFile(file);
    const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
    for (const rule of headerRules) if (matches(rule.pattern, rel)) Object.assign(headers, rule.headers);
    res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

http
  .createServer(async (req, res) => {
    try {
      const request = await toRequest(req);
      const { pathname } = new URL(request.url);
      const api = await handle(request, env);
      if (api) {
        res.writeHead(api.status, Object.fromEntries(api.headers));
        res.end(Buffer.from(await api.arrayBuffer()));
        return;
      }
      await serveStatic(req, res, pathname);
    } catch (err) {
      console.error(err);
      res.writeHead(500).end('Server error');
    }
  })
  .listen(PORT, () => {
    console.log(`Cookalong dev server: http://localhost:${PORT}  (${MOCK ? 'pretend AI, no cost' : 'real AI'})`);
    if (!MOCK && !env.OPENROUTER_API_KEY) {
      console.log('No OPENROUTER_API_KEY found in .dev.vars. Use "npm run dev:mock" to try it without one.');
    }
  });
