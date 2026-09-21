# Technical Guide — Signed OAuth Integration

## Architecture and trust boundary

This repository runs the issuer, `oauth.lzc2002.top`. The consuming application owns local accounts, sessions, authorization state and replay protection. [INTEGRATION_EXAMPLES.js](INTEGRATION_EXAMPLES.js) belongs in that consumer; it does not add routes to the issuer's `index.js`.

```text
Browser -> consumer POST /oauth/start
Consumer -> issues a browser-bound one-time ticket and returns authorization URL
Browser -> issuer /<provider>?redirect=<callback>&state=<ticket>
Issuer <-> provider authentication, token exchange and profile retrieval
Issuer -> browser form containing signed assertion
Browser -> consumer POST /oauth/callback
Consumer -> verifies assertion, attaches identity to ticket, redirects to /oauth/done
Browser -> same-origin POST /oauth/complete
Consumer -> atomically redeems ticket and creates local session
```

The browser can change every ordinary form field. The signed assertion provides identity integrity and issuer authentication. The consumer ticket ties it to the authorization attempt; an HttpOnly browser cookie ties redemption to the initiating browser. OAuth names the parameter carrying the ticket `state`. Both checks are required.

## Issuer configuration

See [SIGNED_CALLBACKS.md](SIGNED_CALLBACKS.md). Configure a dedicated RSA private key and exact callback list on Vercel. Install the corresponding public key in the consumer.

The shared `buildPostForm()` calls `callbackFields()` in `src/security/identity-assertion.js` after an adapter obtains a provider profile. Configured callbacks receive only `assertion`; other callbacks retain the legacy unsigned format. `index.js` applies `Cache-Control: no-store`.

## Wire format and validation

```http
POST /oauth/callback HTTP/1.1
Content-Type: application/x-www-form-urlencoded

assertion=<header>.<claims>.<signature>
```

The fixed JWT header is `{ "alg": "RS256", "typ": "JWT" }`.

| Claim | Required validation |
|---|---|
| `iss` | Exact configured issuer |
| `aud` | Exact consumer callback URL; never derive the expected value from untrusted headers |
| `sub` | Nonempty provider identity, at most 512 characters |
| `platform` | Allowed provider matching the stored authorization |
| `nonce` | Matching server-generated ticket carried in OAuth `state` |
| `iat`, `exp` | Integer Unix seconds; unexpired, lifetime at most 120 seconds, limited future clock skew |
| `jti` | Nonempty unique assertion ID |
| `name`, `email`, `avatar` | Optional strings bounded to 200, 320 and 1024 characters; avatar must use HTTPS |

Verify with a pinned RSA public key of at least 2048 bits. Do not accept the algorithm or verification key from the request. Reject malformed signatures and unexpected algorithms. Do not merely decode the JWT. Render profile fields as text and never auto-link accounts by email.

## Consumer server example

[INTEGRATION_EXAMPLES.js](INTEGRATION_EXAMPLES.js) is a CommonJS module using Node's built-in crypto and standard `Request`/`Response` APIs. It exports `createLoginExample()` and `verifyAssertion()`. The tested example requires Node 22 or newer.

```js
const { createLoginExample } = require('./INTEGRATION_EXAMPLES');
const { ticketStore, createSessionToken } = require('./your-application-adapters');

const oauth = createLoginExample({
  origin: process.env.APP_ORIGIN,
  publicKeyPem: process.env.OAUTH_ASSERTION_PUBLIC_KEY,
  ticketStore,
  createSessionToken,
});
```

The adapter module above is application-owned. There is no production Map fallback or built-in account database. `createSessionToken(identity)` must resolve a known `(platform, id)` binding, persist a fresh application session and return its opaque token. Reject unknown identities or send them through a separate verified registration flow; do not silently bind by name or email. The example session cookie lasts one hour, and the session store must enforce expiry and revocation.

Mount these consumer routes:

| Method/path | Handler |
|---|---|
| `POST /oauth/start` | `oauth.start(request)` |
| `POST /oauth/callback` | `oauth.callback(request)` |
| `POST /oauth/complete` | `oauth.complete(request)` |
| `GET /oauth/done` | Your static completion page |

For a Next.js App Router application using the Node runtime:

```js
// app/oauth/callback/route.js
import { oauth } from '../../configured-oauth';
export const runtime = 'nodejs';
export async function POST(request) {
  return oauth.callback(request);
}
```

For Express, parse form/JSON bodies with a small size limit and construct a standard `Request` with your configured application origin. Copy `Cookie`, `Origin` and `Content-Type`; re-encode parsed form bodies with `URLSearchParams`. Preserve separate `Set-Cookie` headers (`response.headers.getSetCookie()`), rather than joining them with commas.

## Four-step ticket flow

The consumer-side handoff follows the same core pattern as an SSO ticket:

1. **Issue** — create an opaque, expiring ticket bound to the browser and provider.
2. **Authenticate** — carry the ticket through OAuth's standard `state` parameter while the issuer authenticates the user.
3. **Attach** — verify the signed assertion and attach its normalized identity to the matching unused ticket.
4. **Redeem** — from the originating browser, atomically delete the ticket, obtain its identity, and create the local session.

The ticket is a consumer-owned correlation and redemption handle. It is not a
provider-issued SSO ticket, provider access token, local session, or substitute
for verifying the assertion. Before attachment it is only OAuth correlation
state; verification changes the stored record into a redeemable ticket.

## Shared ticket store

Use persistent shared storage such as Durable Objects, PostgreSQL or Redis with atomic operations. In-memory state disappears on serverless cold starts and does not coordinate concurrent requests.

The example requires:

| Method | Contract |
|---|---|
| `issue({ ticket, browserHash, provider, expiresAt })` | Insert a new unique ticket; never overwrite an existing ticket |
| `attachIdentity({ ticket, provider, identity, expiresAt, now })` | Update an existing, unexpired, matching-provider ticket only if no identity exists; cap expiry at the assertion expiry; return whether one row changed |
| `redeem({ ticket, browserHash, now })` | Atomically delete and return identity only for a verified, unexpired ticket belonging to this browser |

A SQL implementation can use conditional `UPDATE ... RETURNING` and `DELETE ... RETURNING`. Never implement consumption as an unprotected SELECT followed by DELETE. Clean up expired rows and hash browser secrets before persistence.

For binding, additionally store the intended operation and initiating authenticated user ID. For registration or binding an existing local account, issue a separate browser-bound, expiring, single-use registration ticket after identity verification; verify the existing account password where applicable. Consumers may implement these extensions in a SQLite-backed Durable Object, PostgreSQL, Redis, or another store with atomic redemption.

## SameSite and browser completion

A cross-site form POST normally omits `SameSite=Lax` cookies. The callback therefore verifies the signed identity, attaches it to the ticket, sets a short-lived ticket-reference cookie and redirects with 303. It does not issue a user session.

On the resulting same-origin page, `POST /oauth/complete` includes the originating browser cookie. The backend checks ownership and redeems the ticket before creating a local session. Keep cookies `Secure`, `HttpOnly`, `SameSite=Lax`, with `__Host-` names, `Path=/`, and no Domain attribute. Use HTTPS for local browser testing.

A static page cannot inspect the incoming POST body or inherit the issuer's hidden inputs. It must follow a backend callback. Identity, assertions, access tokens and application sessions do not need to appear in URLs or `postMessage`.

### Same-tab login

```js
async function login(provider) {
  const response = await fetch('/oauth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  location.assign(result.authUrl);
}
```

### Completion page

```js
async function finish() {
  const response = await fetch('/oauth/complete', { method: 'POST' });
  if (!response.ok) throw new Error('Authorization expired or invalid; restart login');
  if (window.opener) {
    window.opener.postMessage({ type: 'oauth_complete' }, location.origin);
    window.close();
  } else {
    location.assign('/dashboard');
  }
}
finish().catch(error => {
  document.getElementById('status').textContent = error.message;
});
```

For a popup, open `about:blank` synchronously in the click handler before awaiting `/oauth/start`. Add the message listener before navigating it. Accept only messages where `event.origin === location.origin`, `event.source === popup`, and `event.data.type === 'oauth_complete'`. The message is a completion notification; obtain identity from the authenticated `/me` endpoint. Remove listeners and timers on all exit paths.

## Issuer API and errors

`GET /` returns version and enabled services. `GET /<provider>?redirect=...&state=...` starts provider authentication. There is no issuer `/oauth/start`, `/oauth/complete`, or generic one-time-code redemption endpoint in this implementation; those example routes belong to the consumer.

When no callback is resolved, some adapters return JSON from a provider-specific exchange. This is not a portable browser integration because redirect and state requirements differ by provider. Never copy a browser result into an authentication endpoint.

Provider errors may use GET redirects with `error` and `state` query parameters or return JSON/text responses. No universal error POST is guaranteed. Error paths must never establish sessions or downgrade to unsigned identity data.

## Legacy format

Unlisted callback destinations still receive ordinary form fields such as `id`, `name`, `email`, `url`, `avatar`, `platform`, `state`, and `originalResponse`. `originalResponse` is the provider-specific raw profile object from which the normalized fields were derived; its exact shape differs by provider and can contain additional personal data. Direct JSON delivery returns it as an object, while `buildPostForm()` sends it as a JSON-encoded string. This compatibility format is not authentication evidence when received through the browser. Configured signed callbacks exclude `originalResponse` from the JWT.

## Provider notes

- GitHub currently uses the login name as `id`; renames can affect identity continuity.
- QQ prefers `unionid` over `openid` and synthesizes an email when none exists.
- Twitter/X uses OAuth 2.0 PKCE and may synthesize an email.
- Huawei stores redirect context in a process-local Map; multi-instance deployments need shared state.
- Steam uses OpenID 2.0, verifies the assertion server-side, and synthesizes an email.
- Weibo legacy delivery may include a large base64 avatar. Signed delivery omits base64 avatars.
- Generic OIDC can use discovery or explicit endpoints and has provider-specific redirect requirements.
- Only `microsoft-consumers` is currently exported. Tenant/common source files exist but must be enabled and validated separately.

## Optional profile persistence

With `POSTGRES_URL`, the issuer schedules a background profile upsert into `wl_3rd_info`. This table is not a consumer session store or replay store.

```sql
CREATE TABLE wl_3rd_info (
  platform TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  avatar TEXT,
  url TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (platform, id)
);
```

## Deployment and troubleshooting

Coordinate issuer and consumer deployment so the consumer rejects unsigned callbacks throughout rollout. Existing sessions and bindings are not automatically revoked.

- Unsigned fields: callback URL does not exactly match `OAUTH_ASSERTION_CALLBACKS`.
- Invalid signature: public/private keys or pinned issuer differ.
- Invalid audience: the consumer's fixed callback differs from the signed destination.
- Missing browser context: use HTTPS and keep host/cookie context stable; Lax cookies are not expected on the cross-site POST.
- Expired or used authorization: restart login; replay is intentionally rejected.
- Provider absent: inspect `src/index.js` and required credentials.

Run `npm test` and `node --check INTEGRATION_EXAMPLES.js`. Then verify real provider exchanges, HTTPS cookies, and desktop/mobile browser flows after deployment.
