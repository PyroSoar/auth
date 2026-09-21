/**
 * Signed OAuth consumer example (CommonJS, Node 22+).
 * These handlers belong in YOUR APPLICATION, not in the OAuth issuer.
 * Mount them as POST /oauth/start, POST /oauth/callback, POST /oauth/complete.
 * Serve /oauth/done separately; see TECHNICAL_GUIDE.md for browser/framework use.
 *
 * Required application adapters (no insecure in-memory production defaults):
 * ticketStore.issue({ ticket, browserHash, provider, expiresAt })
 * ticketStore.attachIdentity({ ticket, provider, identity, expiresAt, now }) -> boolean
 *   Atomically fill ONLY an unexpired, matching, not-yet-verified flow. Cap the
 *   existing expiry at assertion expiry. Never insert an unknown ticket here.
 * ticketStore.redeem({ ticket, browserHash, now }) -> identity | null
 *   Atomically delete and return ONLY a verified, unexpired, browser-owned flow.
 * createSessionToken(identity) -> fresh opaque session token
 *   Resolve an existing account by (platform, id). Do not auto-link by email.
 *   Persist/rotate the application session; this is not the provider assertion.
 *
 * Use a shared database for these adapters in serverless/multi-instance apps.
 * The ticket travels in OAuth's standard `state` parameter and the assertion's
 * `nonce` claim. This example implements login only. Account binding must also
 * save and check the initiating local account and operation in the ticket row.
 *
 * Provider adapters also produce `originalResponse`, containing the raw profile
 * response. Legacy callbacks and direct JSON results may include it. Signed
 * assertions intentionally contain only normalized, bounded identity claims.
 * Example legacy/direct result:
 * {
 *   id: 'octocat', name: 'The Octocat', email: 'octocat@github.com',
 *   url: 'https://github.com/octocat', avatar: 'https://avatars.githubusercontent.com/...',
 *   platform: 'github', originalResponse: { login: 'octocat', id: 1, ... }
 * }
 */
const { createHash, createPublicKey, randomBytes, randomUUID, verify } = require('node:crypto');

const AUTH_SERVICE = 'https://oauth.lzc2002.top';
const PROVIDERS = ['github', 'google', 'qq', 'facebook', 'weibo', 'twitter', 'huawei', 'steam', 'oidc', 'microsoft-consumers'];
const BROWSER = '__Host-example_oauth_browser';
const TICKET = '__Host-example_oauth_ticket';
const cookie = (name, value, seconds) => name + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + seconds;
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const getCookie = (request, name) => (request.headers.get('Cookie') || '').split(';')
  .map(value => value.trim()).find(value => value.startsWith(name + '='))?.slice(name.length + 1) || '';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

function verifyAssertion(assertion, publicKey, audience) {
  if (typeof assertion !== 'string' || assertion.length > 12000) throw new Error('Invalid assertion');
  const parts = assertion.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid assertion');
  const parse = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  const header = parse(parts[0]);
  if (header.alg !== 'RS256' || header.typ !== 'JWT' || header.crit) throw new Error('Invalid algorithm');
  if (!verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1], 'utf8'), publicKey, Buffer.from(parts[2], 'base64url'))) {
    throw new Error('Invalid signature');
  }
  const claims = parse(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== AUTH_SERVICE || claims.aud !== audience ||
      !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
      claims.iat > now + 30 || claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat > 120 ||
      typeof claims.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(claims.nonce) ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 512 ||
      typeof claims.jti !== 'string' || !claims.jti || !PROVIDERS.includes(claims.platform)) {
    throw new Error('Invalid claims');
  }
  for (const [field, limit] of [['name', 200], ['email', 320], ['avatar', 1024]]) {
    if (claims[field] != null && (typeof claims[field] !== 'string' || claims[field].length > limit)) throw new Error('Invalid profile');
  }
  if (claims.avatar && !claims.avatar.startsWith('https://')) throw new Error('Invalid avatar');
  return claims;
}

function createLoginExample({ origin, publicKeyPem, ticketStore, createSessionToken }) {
  if (!origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) throw new Error('Configure an exact HTTPS application origin');
  if (!publicKeyPem || !ticketStore || typeof createSessionToken !== 'function') throw new Error('Missing application configuration');
  for (const method of ['issue', 'attachIdentity', 'redeem']) {
    if (typeof ticketStore[method] !== 'function') throw new Error('Missing ticket store adapter: ' + method);
  }
  const publicKey = createPublicKey(publicKeyPem.replace(/\\n/g, '\n'));
  if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Invalid RSA public key');
  const callbackUrl = origin + '/oauth/callback';
  const sameOriginPost = request => request.method === 'POST' && request.headers.get('Origin') === origin;

  return {
    async start(request) {
      if (!sameOriginPost(request)) return json({ error: 'invalid_origin_or_method' }, 403);
      const body = await request.json().catch(() => null);
      if (!body || !PROVIDERS.includes(body.provider)) return json({ error: 'invalid_provider' }, 400);
      let browser = getCookie(request, BROWSER);
      if (!/^[a-f0-9]{64}$/.test(browser)) browser = randomBytes(32).toString('hex');
      const ticket = randomUUID();
      await ticketStore.issue({ ticket, browserHash: digest(browser), provider: body.provider, expiresAt: Date.now() + 600000 });
      const url = new URL('/' + body.provider, AUTH_SERVICE);
      url.searchParams.set('redirect', callbackUrl);
      // OAuth calls this parameter `state`; for the consumer it is a one-time ticket.
      url.searchParams.set('state', ticket);
      const response = json({ authUrl: url.href });
      response.headers.set('Set-Cookie', cookie(BROWSER, browser, 3600));
      return response;
    },

    async callback(request) {
      if (request.method !== 'POST') return json({ error: 'post_required' }, 405);
      const text = await request.text();
      if (text.length > 16000) return json({ error: 'body_too_large' }, 413);
      let claims;
      try { claims = verifyAssertion(new URLSearchParams(text).get('assertion'), publicKey, callbackUrl); }
      catch { return json({ error: 'invalid_assertion' }, 401); }
      const attached = await ticketStore.attachIdentity({
        ticket: claims.nonce, provider: claims.platform, expiresAt: claims.exp * 1000, now: Date.now(),
        identity: { platform: claims.platform, id: claims.sub, name: claims.name ?? null, email: claims.email ?? null, avatar: claims.avatar ?? null },
      });
      if (!attached) return json({ error: 'invalid_ticket' }, 400);
      // Cross-site form POST may omit Lax cookies. No session is issued here.
      return new Response(null, { status: 303, headers: {
        Location: origin + '/oauth/done', 'Cache-Control': 'no-store',
        'Set-Cookie': cookie(TICKET, claims.nonce, 120),
      } });
    },

    async complete(request) {
      if (!sameOriginPost(request)) return json({ error: 'invalid_origin_or_method' }, 403);
      const browser = getCookie(request, BROWSER);
      const ticket = getCookie(request, TICKET);
      if (!/^[a-f0-9]{64}$/.test(browser) || !ticket) return json({ error: 'missing_browser_context' }, 400);
      const identity = await ticketStore.redeem({ ticket, browserHash: digest(browser), now: Date.now() });
      if (!identity) return json({ error: 'expired_or_used_authorization' }, 400);
      const token = await createSessionToken(identity);
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Session adapter must return a fresh opaque token');
      const response = json({ authenticated: true });
      response.headers.append('Set-Cookie', cookie('__Host-example_session', token, 3600));
      response.headers.append('Set-Cookie', cookie(TICKET, '', 0));
      return response;
    },
  };
}

module.exports = { createLoginExample, verifyAssertion };
