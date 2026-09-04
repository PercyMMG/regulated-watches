#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, paths, hasAssociateTag, TAG_PLACEHOLDER } from './lib/config.mjs';
import * as curation from './lib/curation.mjs';
import { buildPack, packToMarkdown } from './lib/socialpack.mjs';
import { writeJson, ensureDir } from './lib/store.mjs';
import { writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CURATE_PORT || 4331);

/* The dashboard writes to your working tree. It binds to loopback only and
 * is never deployed: there is no auth because there is no network surface. */
const HOST = '127.0.0.1';

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Body was not valid JSON.');
  }
}

function state() {
  const all = curation.loadAll();
  return {
    ...all,
    config: {
      brand: config.brand,
      currencySymbol: config.currencySymbol,
      taxonomy: config.taxonomy,
      curation: config.curation,
      social: config.social,
      priceMaxAgeHours: config.price.maxAgeHours,
      hasAssociateTag: hasAssociateTag(),
      associateTagPlaceholder: TAG_PLACEHOLDER,
    },
  };
}

const ROUTES = [
  ['GET', /^\/api\/state$/, () => state()],

  ['POST', /^\/api\/watch\/([A-Z0-9]{10})\/save$/, (m, body) => curation.saveWatch(m[1], body)],
  ['POST', /^\/api\/watch\/([A-Z0-9]{10})\/approve$/, (m) => curation.approve(m[1])],
  ['POST', /^\/api\/watch\/([A-Z0-9]{10})\/reject$/, (m, body) => curation.reject(m[1], body.reason || '')],
  ['POST', /^\/api\/watch\/([A-Z0-9]{10})\/restore$/, (m) => curation.restore(m[1])],
  ['POST', /^\/api\/watch\/([A-Z0-9]{10})\/confirm$/, (m, body) => curation.confirmDraft(m[1], body.field)],
  ['POST', /^\/api\/watch\/([A-Z0-9]{10})\/regenerate$/, (m, body) => curation.regenerate(m[1], body.field)],
  ['DELETE', /^\/api\/watch\/([A-Z0-9]{10})$/, (m) => curation.destroy(m[1])],

  ['POST', /^\/api\/bulk$/, (m, body) => curation.bulk(body.action, body.asins, body.reason)],

  ['POST', /^\/api\/collection$/, (m, body) => curation.saveCollection(body)],
  ['DELETE', /^\/api\/collection\/([a-z0-9-]+)$/, (m) => curation.deleteCollection(m[1])],

  ['POST', /^\/api\/comparison$/, (m, body) => curation.saveComparison(body)],
  ['DELETE', /^\/api\/comparison\/([a-z0-9-]+)$/, (m) => curation.deleteComparison(m[1])],

  ['POST', /^\/api\/social\/pack$/, (m, body) => {
    const approved = curation.loadAll().approved;
    const chosen = (body.asins || []).map((a) => {
      const w = approved.find((x) => x.asin === a);
      if (!w) throw new Error(`${a} is not an approved watch. Only approved watches can go in a pack.`);
      return w;
    });
    const pack = buildPack(chosen, { title: body.title, startDate: body.startDate });
    ensureDir(paths.social);
    writeJson(paths.social, `${pack.id}.json`, pack);
    writeFileSync(join(paths.social, `${pack.id}.md`), packToMarkdown(pack), 'utf8');
    return { pack_id: pack.id, clean: pack.compliance.clean, issues: pack.compliance.issues, files: [`content/social/${pack.id}.json`, `content/social/${pack.id}.md`] };
  }],
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  // This process writes to your working tree, so both checks below matter.
  //
  // Host, first: binding to loopback stops other machines connecting, but not
  // DNS rebinding. A page on evil.com whose DNS re-points to 127.0.0.1 reaches
  // this server, and the browser treats it as same-origin — so it sends no
  // Origin header on a GET and the Origin check below waves it through.
  // Pinning Host to the addresses we actually listen on closes that.
  const host = String(req.headers.host || '');
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`];
  if (!allowedHosts.includes(host)) {
    return json(res, 403, {
      error: `Unexpected Host header "${host}". Reach this dashboard at http://${HOST}:${PORT} only.`,
    });
  }

  // Origin, second: blocks ordinary cross-origin calls from a page you visited.
  const origin = req.headers.origin;
  if (origin && !origin.startsWith(`http://${HOST}:${PORT}`) && !origin.startsWith(`http://localhost:${PORT}`)) {
    return json(res, 403, { error: 'Cross-origin requests are not accepted.' });
  }

  if (path.startsWith('/api/')) {
    try {
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      for (const [method, re, handler] of ROUTES) {
        if (req.method !== method) continue;
        const m = re.exec(path);
        if (!m) continue;
        return json(res, 200, { ok: true, data: await handler(m, body) });
      }
      return json(res, 404, { ok: false, error: `No route for ${req.method} ${path}` });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message, blocking: err.blocking || null });
    }
  }

  if (path === '/' || path === '/index.html') {
    const file = join(HERE, 'ui', 'index.html');
    if (!existsSync(file)) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      return res.end('scripts/ui/index.html is missing.');
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    });
    return res.end(readFileSync(file));
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  const s = curation.loadAll();
  console.log('');
  console.log(`  ${config.brand} — curation dashboard`);
  console.log(`  ${'-'.repeat(52)}`);
  console.log(`  http://${HOST}:${PORT}`);
  console.log('');
  console.log(`  pending ${s.pending.length}   approved ${s.approved.length}   rejected ${s.rejected.length}`);
  console.log(`  collections ${s.collections.length}   comparisons ${s.comparisons.length}   social packs ${s.social.length}`);
  if (!hasAssociateTag()) {
    console.log('');
    console.log(`  ! affiliate.associateTag is still "${TAG_PLACEHOLDER}" in site.config.json.`);
    console.log('    The site will build, but every buy button will be disabled until you set it.');
  }
  console.log('');
  console.log('  Writes straight into ./content. Commit when you are happy. Ctrl+C to stop.');
  console.log('');
});
