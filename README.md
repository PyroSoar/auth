# OAuth Center

A Koa service deployed at `https://oauth.lzc2002.top` that exchanges provider authorization codes, retrieves profiles, and delivers results to a consuming application. Provider adapters also handle Steam OpenID 2.0.

For account login or binding, configure signed callbacks and verify them on your backend. Ordinary `id/name/email/platform/state/originalResponse` fields submitted by a browser are not proof of identity. HTTPS and matching state values alone do not authenticate those fields.

## Vercel entrypoint

Import this repository directly as a Vercel project. The root `index.js` is the serverless entrypoint and exports `app.callback()` from Koa; provider routes are loaded from `src/index.js`. No separate build output, wrapper API route, or framework adapter is required. Keep deployment configuration and environment variables on the Vercel project.

## Project structure

- `index.js` is the Vercel function entrypoint.
- `src/base.js` coordinates the provider callback lifecycle.
- `src/services/` resolves callback context and normalizes provider profiles.
- `src/delivery/` owns browser delivery formats, including the legacy form POST.
- `src/security/` creates signed identity assertions for configured consumers.
- `src/media/` handles provider media conversion.
- Provider files such as `src/github.js` contain only provider-specific authorization and profile exchange logic.
- `src/huawei-honor-core.js` is shared by the two HONOR/Huawei adapters; `src/huawei.js` and `src/honor.js` only declare hosts, credentials and route.
- `test/` covers assertion, delivery, and integration contracts.

## Usage methods

The service exposes provider discovery and several delivery/integration methods.
Choose the method according to the trust required by the consuming application.

### 1. Discover enabled providers

Request the service root:

```http
GET https://oauth.lzc2002.top/
```

The response contains the deployed version and the provider adapters whose
required credentials are configured:

```json
{
  "version": "1.2.0",
  "services": [
    { "name": "github", "origin": "github.com" }
  ]
}
```

Treat this response as the provider availability source instead of hardcoding a
provider list. Exact metadata fields can differ between adapters.

### 2. Signed browser callback for login, registration, or account binding

Use this method whenever provider identity changes account access. The consumer
backend creates a random, expiring, one-time ticket and associates it with the
initiating browser, provider, and intended operation. The browser is then sent to:

```text
https://oauth.lzc2002.top/<provider>?redirect=<encoded-https-callback>&state=<ticket>
```

Example browser code:

```js
const authorization = new URL('https://oauth.lzc2002.top/github')
authorization.searchParams.set('redirect', 'https://app.example/api/oauth/callback')
authorization.searchParams.set('state', ticketFromApplicationBackend)
location.assign(authorization.href)
```

The exact callback URL must appear in `OAUTH_ASSERTION_CALLBACKS`. After provider
authentication, the browser submits this form body to that callback:

```text
Content-Type: application/x-www-form-urlencoded

assertion=<RS256-signed-JWT>
```

The consumer backend must verify `alg`, signature, `iss`, exact `aud`, `iat`,
`exp`, `platform`, and `nonce`; match `nonce` to its stored ticket and browser;
and atomically redeem the ticket before creating a session or binding an account.
Do not accept additional browser fields as identity. See
[INTEGRATION_EXAMPLES.js](INTEGRATION_EXAMPLES.js) for complete Node handlers.

### 3. Multiple signed consumer systems

One issuer key can serve multiple systems. Register every exact HTTPS callback in
the Vercel environment variable:

```json
[
  "https://app-one.example/api/oauth/callback",
  "https://app-two.example/api/oauth/callback"
]
```

Give each consumer the same public key; keep the private key only in this Vercel
project. Each consumer verifies its own exact callback as `aud` and maintains its
own ticket store. An assertion issued for one callback cannot be replayed at a
different callback because its audience will not match.

Adding a consumer does not require a new key. The current implementation has one
issuer signing key, so replacing `OAUTH_ASSERTION_PRIVATE_KEY` rotates the key for
all signed consumers. Update every consumer's public key during the same rollout.
Per-consumer keys and overlapping zero-downtime rotation would require a keyring
and a JWT `kid`; they are not implemented currently.

### 4. Legacy unsigned browser callback

A callback URL absent from `OAUTH_ASSERTION_CALLBACKS` continues to receive a
self-submitting form containing normalized fields such as:

```text
id, name, email, url, avatar, platform, state, originalResponse
```

`originalResponse` is JSON-encoded in the form field. Parse it explicitly only
when needed:

```js
const original = req.body.originalResponse
  ? JSON.parse(req.body.originalResponse)
  : null
```

This method is retained for compatibility and non-security uses such as importing
display profile information. The form passes through the browser, so none of its
fields prove identity. Never use this method for login, registration, account
recovery, privilege changes, or binding accounts.

### 5. Direct JSON provider result

When no `redirect` is resolved, a completed provider exchange returns the
normalized profile as JSON instead of generating a form. This is suitable only
when a trusted backend controls the authorization-code exchange and consumes the
response directly. A JSON object copied or forwarded by a browser is still
untrusted.

The normalized result includes `originalResponse` as an object rather than a JSON
string. Provider authorization codes remain single-use and must use the redirect
URI registered with that provider; this mode does not bypass provider redirect-URI
rules.

### Provider route parameters

All exported providers use a route named after the adapter, for example
`/github`, `/google`, `/qq`, `/oidc`, or `/microsoft-consumers`.

| Parameter | Purpose |
|---|---|
| `redirect` | Consumer callback. Exact configured HTTPS URLs receive signed delivery; other URLs receive the legacy form. |
| `state` | Opaque consumer correlation value. In signed account flows it carries the one-time ticket. |
| `code` | Provider authorization code on the provider callback. Consumers normally do not set it themselves. |
| `error`, `error_description` | Provider error values returned during a failed authorization. |

Do not place identity, passwords, access tokens, or other sensitive application
state inside `state`; use an opaque random ticket that resolves to server-side
state.

## Quick start: signed login

1. Configure provider credentials and `SERVER_URL` on the auth service.
2. Generate a dedicated RSA key pair of at least 2048 bits. Keep the PKCS#8 private key in the auth service's `OAUTH_ASSERTION_PRIVATE_KEY`; give the SPKI public key to your application backend.
3. Set `OAUTH_ASSERTION_CALLBACKS` to a JSON array of exact HTTPS callback URLs:

   ```json
   ["https://app.example/oauth/callback"]
   ```

4. Your application backend issues a random, expiring, one-time ticket tied to the initiating browser and provider. The ticket is carried in OAuth's standard `state` parameter:

   ```text
   https://oauth.lzc2002.top/github?redirect=<encoded-callback>&state=<server-generated-ticket>
   ```

5. After provider authentication, the service returns a self-submitting HTML form. The browser sends the configured callback an `application/x-www-form-urlencoded` body containing only:

   ```text
   assertion=<RS256-signed-JWT>
   ```

6. Your backend verifies the signature, issuer, exact audience, lifetime, provider and stored ticket. It then checks the originating browser and atomically redeems the ticket before creating a local session.

This is a four-step SSO-ticket-style handoff: issue ticket, authenticate at the
provider, attach the signed identity to the ticket, then redeem it once. The
OAuth protocol still names the transport parameter `state`; `ticket` is the
consumer-side name for the opaque server record and handle. More precisely, it
starts as a correlation handle and becomes redeemable only after the callback's
signature and claims have been verified; it is not a provider-issued SSO ticket.

The sample [INTEGRATION_EXAMPLES.js](INTEGRATION_EXAMPLES.js) exports Node request handlers for this flow. Supply a shared authorization store and your application's account/session adapter. [TECHNICAL_GUIDE.md](TECHNICAL_GUIDE.md) explains routing, storage contracts, same-tab completion and popup use.

## Delivery formats

| Destination | Successful result | Consumer responsibility |
|---|---|---|
| Exact URL in `OAUTH_ASSERTION_CALLBACKS` | Form POST containing only `assertion` | Verify signature and claims, then enforce browser-bound single use |
| Other callback URL | Legacy profile fields in a form POST | Do not use unsigned browser fields as account-authentication proof |
| Provider exchange without a resolved callback | Direct JSON profile response | Perform the exchange on a trusted backend; never accept a browser's copy as proof |

The callback list selects signed delivery. It is not a global redirect allowlist. Omitting a callback does not disable it; other consumers retain the legacy format.

POST keeps the payload out of the callback URL. It does not hide the payload from the browser or prevent body logging. The current automatic form submission requires JavaScript. A static HTML page cannot inspect an incoming HTTP POST body; the callback must be handled by a backend.

## Signed claims

The JWT is signed, not encrypted. Treat it as short-lived authentication material.

| Claim | Meaning |
|---|---|
| `iss` | `https://oauth.lzc2002.top` by default |
| `aud` | Exact configured callback URL |
| `sub` | Provider identity, mapped from the adapter's `id` |
| `platform` | Provider identifier |
| `nonce` | Consumer ticket transported through the OAuth `state` parameter |
| `iat`, `exp` | Unix seconds; lifetime is 120 seconds |
| `jti` | Unique assertion identifier |
| `name`, `email`, `avatar` | Optional display fields; `name`/`email` are bounded to 200/320 characters, `avatar` is an HTTPS URL or an inline base64 image with no length bound |

Do not auto-link local accounts by `email`: some adapters omit email entirely and this protocol does not assert email ownership. Provider access tokens, `originalResponse`, and profile `url` are excluded from signed delivery; avatars are delivered as HTTPS URLs (`http://` is rewritten) or inline base64 images.

## Normalized provider result

Provider adapters normalize their result before callback or direct JSON delivery:

| Field | Meaning |
|---|---|
| `id` | Provider-specific account identifier |
| `name`, `email`, `url`, `avatar` | Normalized profile fields; availability varies by provider |
| `platform` | Provider identifier |
| `state` | Consumer-supplied OAuth state; in the signed flow this transports the ticket |
| `originalResponse` | Raw provider profile response used to build the normalized fields; object in direct JSON, JSON string in a legacy form POST |

Legacy unsigned callbacks and direct JSON responses may include
`originalResponse`. `buildPostForm()` serializes this object with `JSON.stringify`,
so a legacy form consumer must parse that field explicitly. Its structure is
provider-specific and can contain extra personal data, so consumers should avoid
logging or exposing it. Configured
signed callbacks receive only `assertion`; `originalResponse` is intentionally
not copied into the JWT.

```json
{
  "id": "octocat",
  "name": "The Octocat",
  "email": "octocat@github.com",
  "url": "https://github.com/octocat",
  "avatar": "https://avatars.githubusercontent.com/...",
  "platform": "github",
  "originalResponse": {
    "login": "octocat",
    "id": 1
  }
}
```

## Configuration

Configure each variable separately in Vercel:

| Variable | Purpose |
|---|---|
| `SERVER_URL` | Canonical service URL; set explicitly in deployed environments |
| `OAUTH_ASSERTION_PRIVATE_KEY` | Dedicated RSA private key, PKCS#8 PEM |
| `OAUTH_ASSERTION_CALLBACKS` | JSON array of exact signed callback URLs |
| `OAUTH_ASSERTION_ISSUER` | Optional issuer override; defaults to `https://oauth.lzc2002.top` |
| `POSTGRES_URL` | Optional background profile persistence |
| `GITHUB_ID`, `GITHUB_SECRET` | GitHub |
| `GOOGLE_ID`, `GOOGLE_SECRET` | Google |
| `QQ_ID`, `QQ_SECRET` | QQ |
| `FACEBOOK_ID`, `FACEBOOK_SECRET` | Facebook |
| `WEIBO_ID`, `WEIBO_SECRET` | Weibo |
| `TWITTER_ID`, `TWITTER_SECRET` | Twitter/X |
| `HUAWEI_ID`, `HUAWEI_SECRET` | Huawei |
| `HONOR_ID`, `HONOR_SECRET` | Honor |
| `STEAM_KEY` | Steam |
| `MS_client_Id`, `MS_client_secret` | Microsoft personal accounts |
| `OIDC_ID`, `OIDC_SECRET`, `OIDC_ISSUER` | Generic OIDC; explicit endpoints are also supported |
| `ORCID_ID`, `ORCID_SECRET` | ORCID; register `https://<SERVER_URL>/orcid` as the authorized redirect URI |
| `ALIPAY_APP_ID` | 支付宝开放平台分配的应用 ID（AppID） |
| `ALIPAY_PRIVATE_KEY` | 支付宝应用私钥（RSA2 签名用，PKCS#1/PKCS#8 PEM，支持真实换行或字面 `\n`） |
| `ALIPAY_PUBLIC_KEY` | 支付宝公钥，用于验签网关返回（预留，暂未强制校验） |

For OIDC without discovery, configure `OIDC_AUTH_URL`, `OIDC_TOKEN_URL`, and `OIDC_USERINFO_URL`. `OIDC_SCOPES` defaults to `openid profile email`. `MS_tenant_Id` is needed if you separately enable the Microsoft tenant adapter.

`OAUTH_ASSERTION_PUBLIC_KEY` is a consumer setting, not an auth-service secret. Missing signing keys fail closed for configured signed destinations. Actual PEM newlines and literal `\n` sequences are accepted.

See [SIGNED_CALLBACKS.md](SIGNED_CALLBACKS.md) for key generation and coordinated rollout. Each consuming application is responsible for its callback route, ticket storage, account binding, and session creation.

## Providers and compatibility

`GET /` returns `{ version, services }`; enabled providers depend on exported adapters and configured credentials. Check this endpoint instead of hardcoding availability.

The current exports are `github`, `google`, `qq`, `facebook`, `weibo`, `twitter`, `huawei`, `honor`, `steam`, `oidc`, `orcid`, `alipay`, and `microsoft-consumers`. Source files for `microsoft-tenant` and `microsoft-common` exist but their exports are commented out in `src/index.js`.

GitHub currently identifies users by login name; QQ prefers unionid over openid; providers omit email when the upstream profile does not include one. This update does not migrate existing provider IDs. OIDC has provider-specific redirect requirements. ORCID enriches `originalResponse` with the public `works` (publications) and `person` records fetched from `pub.orcid.org` on every login; this fetch is best-effort and never blocks the login, and it does not change the normalized profile or the signed JWT.

Huawei and Honor are the same account implementation under different brands, so they share one source file, `src/huawei-honor-core.js`; each adapter declares only its hosts, credentials and route. Both use the same authorization-code flow (`/oauth2/v3/authorize`, `/oauth2/v3/token`) and read the profile from `nsp_svc=GOpen.User.getInfo`, preferring it and falling back to a best-effort `id_token` decode when the profile call fails or omits a field. A profile outage therefore degrades to the older Huawei behavior rather than breaking the login. Both echo codes and access tokens with `\` escapes and document stripping them before use; the core does that and leaves URL-encoding to the HTTP client. Register `https://<SERVER_URL>/huawei` and `https://<SERVER_URL>/honor` as the authorized callback URLs.

The two adapters differ only in how the consumer callback reaches them, which matters because these providers validate `state` against the whitelist `^[0-9a-zA-Z:/._-]{1,255}$`:

| Transport | Used by | Callback rides on | Cost |
|---|---|---|---|
| `query-redirect` | Huawei | the redirect_uri query string, leaving `state` a clean opaque ticket | needs a process-local state bridge, so multi-instance deployments need shared storage |
| `encoded-state` | Honor | base64url JSON inside `state`, keeping redirect_uri bare | roughly a 255-character budget, so an unusually long consumer callback must be shortened |

HONOR rejects a querystring payload outright with `error=1101` / `sub_error=20031` before any login page renders, because it carries `=` and `%`. base64url has no URL delimiters and Node emits it without `=` padding, so it clears the whitelist. Switching a provider between transports changes the callback it sends, so it also requires revisiting the callback registered in that provider's console.

`GOpen.User.getInfo` returns only `openID` — no union id — so `id` falls back to the `id_token` when the profile omits it. Display name comes from `displayName` with `getNickName=1`, which prefers the real nickname over the anonymized account string.

Alipay authenticates through an RSA2 public/private key pair rather than an OAuth client secret. Every gateway call (`alipay.system.oauth.token`, `alipay.user.info.share`) is signed with the merchant application private key; `ALIPAY_PRIVATE_KEY` holds that key as PEM, and literal `\n` sequences are accepted. The adapter normalizes `id` from `open_id` (falling back to `user_id`) and maps `nick_name`/`avatar` into the profile. Register `https://<SERVER_URL>/alipay` as the Alipay authorized callback URL.

Alipay's authorization page rejects mobile browsers outside the Alipay client with "请在支付宝客户端打开链接". The adapter therefore routes by User-Agent: desktop browsers and requests already inside the Alipay client go straight to the authorization URL, while other mobile browsers are sent through Alipay's official hand-off link:

```text
https://ds.alipay.com/?scheme=<encoded alipays://platformapi/startapp?appId=20000067&url=<encoded-authorization-url>>
```

`20000067` is Alipay's built-in web-jump app. This relies on the browser honoring the scheme, so a minority of environments (notably in-app browsers such as WeChat) may fail to launch the client. Providing a manual "open in Alipay" link or a QR fallback in the consuming application is recommended.

## Errors

Provider failures may redirect to the consumer with `error` and `state` query parameters, or return an error response. They are not signed successful identities. Never establish a session from an error response or fall back to unsigned fields. A signing/configuration failure is handled by the service error handler; a universal error POST is not guaranteed.

## Development and checks

```sh
npm install
npm start
npm test
node --check INTEGRATION_EXAMPLES.js
```

`npm start` invokes `vercel dev`. Signed callbacks and Secure consumer cookies require HTTPS for browser testing. Tests use synthetic identities and keys, not real provider accounts.

The checked-in lockfile currently predates several dependencies in `package.json`; `npm ci` fails until it is synchronized. For local validation without changing the lockfile, use `npm install --package-lock=false --ignore-scripts`. Signing itself adds no dependency.

## Documentation

- [Technical guide](TECHNICAL_GUIDE.md): verification, consumer storage, browser flows and provider notes.
- [Signed callback setup](SIGNED_CALLBACKS.md): keys, deployment settings and rollout.
- [Consumer implementation example](INTEGRATION_EXAMPLES.js): server-side handlers with required application adapters.
