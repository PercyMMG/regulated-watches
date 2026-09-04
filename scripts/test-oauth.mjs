#!/usr/bin/env node
/**
 * Tests for the Decap OAuth proxy (functions/api/).
 *
 * Cloudflare Pages Functions run on the same Web APIs Node exposes, so the
 * handlers can be invoked directly with a mock context and a stubbed GitHub.
 * That matters: a broken OAuth handshake is otherwise only visible in
 * production, after a deploy, in a popup window.
 *
 *   npm run test:oauth
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f) => import(pathToFileURL(join(HERE, '..', 'functions', 'api', f)).href);

const auth = await load('auth.js');
const cb = await load('callback.js');

// A fixture origin only. Deliberately example.com so no real domain is
// implied as the deployment target.
const ORIGIN = 'https://example.com';
let failures = 0;
const ok = (name, cond) => {
  if (!cond) failures++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
};

console.log('\n  OAuth proxy\n  ' + '-'.repeat(52));

/* ---- auth.js ---- */

let r = await auth.onRequest({ request: new Request(`${ORIGIN}/api/auth`), env: {} });
ok('auth: missing CLIENT_ID returns 500 rather than a broken redirect', r.status === 500);

r = await auth.onRequest({ request: new Request(`${ORIGIN}/api/auth`), env: { GITHUB_CLIENT_ID: 'cid123' } });
const loc = new URL(r.headers.get('location'));
const cookie = r.headers.get('set-cookie');
const state = /decap_oauth_state=([^;]+)/.exec(cookie)[1];

ok('auth: redirects to github.com', r.status === 302 && loc.host === 'github.com');
ok("auth: scope is 'public_repo', not 'repo'", loc.searchParams.get('scope') === 'public_repo');
ok('auth: redirect_uri points at our own callback', loc.searchParams.get('redirect_uri') === `${ORIGIN}/api/callback`);
ok('auth: state cookie is HttpOnly, Secure, SameSite', /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie));
ok('auth: state in the URL matches the cookie', loc.searchParams.get('state') === state);

/* ---- callback.js ---- */

const env = { GITHUB_CLIENT_ID: 'cid123', GITHUB_CLIENT_SECRET: 'super-secret-value' };

r = await cb.onRequest({
  request: new Request(`${ORIGIN}/api/callback?code=abc&state=WRONG`, { headers: { cookie: `decap_oauth_state=${state}` } }),
  env,
});
let body = await r.text();
ok('callback: mismatched state is rejected (CSRF)', r.status === 400 && body.includes('state did not match'));

r = await cb.onRequest({ request: new Request(`${ORIGIN}/api/callback?code=abc&state=${state}`), env });
ok('callback: missing state cookie is rejected', r.status === 400);

r = await cb.onRequest({ request: new Request(`${ORIGIN}/api/callback`, { headers: { cookie: `decap_oauth_state=${state}` } }), env });
ok('callback: missing code is rejected', r.status === 400);

// Happy path, with GitHub stubbed.
const realFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(JSON.stringify({ access_token: 'gho_TESTTOKEN' }), { headers: { 'content-type': 'application/json' } });
r = await cb.onRequest({
  request: new Request(`${ORIGIN}/api/callback?code=abc&state=${state}`, { headers: { cookie: `decap_oauth_state=${state}` } }),
  env,
});
body = await r.text();
const csp = r.headers.get('content-security-policy');
globalThis.fetch = realFetch;

ok('callback: success returns 200', r.status === 200);
ok('callback: posts authorization:github:success', body.includes('authorization:github:success'));
ok('callback: the token reaches the CMS', body.includes('gho_TESTTOKEN'));
ok('callback: postMessage target is pinned, not a wildcard', body.includes(JSON.stringify(ORIGIN)) && !body.includes("postMessage(payload, '*')"));
ok('callback: CSP uses a nonce and no unsafe-inline', /script-src 'nonce-[0-9a-f-]+'/.test(csp) && !csp.includes('unsafe-inline'));
ok('callback: state cookie is cleared', /decap_oauth_state=;/.test(r.headers.get('set-cookie')));
ok('callback: the client secret never reaches the browser', !body.includes('super-secret-value'));

// GitHub refusing the exchange must not leak detail into the page.
globalThis.fetch = async () =>
  new Response(JSON.stringify({ error: 'bad_verification_code', error_description: 'The code is incorrect.' }), {
    headers: { 'content-type': 'application/json' },
  });
r = await cb.onRequest({
  request: new Request(`${ORIGIN}/api/callback?code=abc&state=${state}`, { headers: { cookie: `decap_oauth_state=${state}` } }),
  env,
});
body = await r.text();
globalThis.fetch = realFetch;
ok('callback: a refused exchange returns an error payload', r.status === 400 && body.includes('authorization:github:error'));

console.log(failures ? `\n  ${failures} failing\n` : '\n  All OAuth checks passed.\n');
process.exit(failures ? 1 : 0);
