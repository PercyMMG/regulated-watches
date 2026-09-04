/**
 * Decap CMS OAuth — step 1 of 2: send the browser to GitHub.
 *
 * Runs as a Cloudflare Pages Function. Free tier covers 100k requests/day and
 * this is called once per login, so it stays inside the zero-cost constraint.
 *
 * Requires two environment variables, set in the Cloudflare Pages dashboard
 * (Settings -> Environment variables), never in this repository:
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET   (used by callback.js, not here)
 */

const SCOPE = 'public_repo';

/**
 * Why `public_repo` and not `repo`:
 *
 * Decap stores the returned token in the browser. The `repo` scope would grant
 * that token read and write access to every repository on the account,
 * including private ones — far beyond what editing this site needs.
 * `public_repo` is enough for a public repo and keeps the blast radius to
 * public repositories if the token ever leaks.
 *
 * If you make the repository private, this has to become `repo`, and the token
 * becomes correspondingly more sensitive.
 */

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.GITHUB_CLIENT_ID) {
    return new Response(
      'GITHUB_CLIENT_ID is not set. Add it in Cloudflare Pages -> Settings -> Environment variables, then redeploy.',
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  }

  const url = new URL(request.url);

  // CSRF defence for the OAuth handshake: a random value that has to come back
  // unchanged. Held in an HttpOnly cookie so page scripts cannot read it.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.origin}/api/callback`,
    scope: SCOPE,
    state,
    allow_signup: 'false',
  });

  return new Response(null, {
    status: 302,
    headers: {
      location: `https://github.com/login/oauth/authorize?${params}`,
      'set-cookie': `decap_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=600`,
      'cache-control': 'no-store',
    },
  });
}
