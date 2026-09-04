/**
 * Decap CMS OAuth — step 2 of 2: exchange the code for a token and hand it
 * back to the CMS window.
 *
 * The client secret is read from the environment and never leaves this
 * function. Only the resulting access token reaches the browser, which is how
 * Decap is designed to work.
 */

const readCookie = (header, name) => {
  const match = String(header || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
};

/** Timing-safe-ish comparison; these are UUIDs, not secrets, but be tidy. */
function sameValue(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function page({ nonce, origin, payload }) {
  // Decap's handshake: the popup announces itself, the CMS window replies, and
  // the popup then posts the result. targetOrigin is pinned to this site so the
  // token is never broadcast to another origin.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signing in…</title></head>
<body><p>Completing sign-in…</p>
<script nonce="${nonce}">
(function () {
  var payload = ${JSON.stringify(payload)};
  var origin = ${JSON.stringify(origin)};
  function send() { window.opener.postMessage(payload, origin); }
  window.addEventListener('message', function onMsg(e) {
    if (e.origin !== origin) return;
    window.removeEventListener('message', onMsg);
    send();
    setTimeout(function () { window.close(); }, 400);
  }, false);
  if (window.opener) {
    window.opener.postMessage('authorizing:github', origin);
  } else {
    document.body.textContent = 'Open the CMS at /admin/ and sign in from there.';
  }
})();
</script></body></html>`;
}

const html = (body, nonce, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Tight, and set here rather than in _headers because this response
      // legitimately needs one inline script and nothing else at all.
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      // Clear the handshake cookie whatever the outcome.
      'set-cookie': 'decap_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0',
    },
  });

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const nonce = crypto.randomUUID();

  const fail = (reason) =>
    html(page({ nonce, origin: url.origin, payload: `authorization:github:error:${JSON.stringify({ message: reason })}` }), nonce, 400);

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return fail('Server is missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET.');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return fail(url.searchParams.get('error_description') || 'GitHub did not return a code.');

  // The state must match the cookie set in auth.js, or this is not our flow.
  const expected = readCookie(request.headers.get('cookie'), 'decap_oauth_state');
  if (!expected || !state || !sameValue(state, expected)) {
    return fail('OAuth state did not match. Start the sign-in again from /admin/.');
  }

  let token;
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'regulated-watches-cms',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/api/callback`,
      }),
    });
    const data = await res.json();
    if (data.error || !data.access_token) {
      return fail(data.error_description || data.error || 'GitHub refused the token exchange.');
    }
    token = data.access_token;
  } catch {
    // Never surface the raw error: it can carry request detail we do not want
    // rendered into the page.
    return fail('Could not reach GitHub to exchange the code.');
  }

  const payload = `authorization:github:success:${JSON.stringify({ token, provider: 'github' })}`;
  return html(page({ nonce, origin: url.origin, payload }), nonce);
}
