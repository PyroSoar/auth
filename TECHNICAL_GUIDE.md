# Technical Guide — Unified OAuth Authentication Service

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Unified Response Format](#unified-response-format)
3. [Installation & Deployment](#installation--deployment)
4. [Environment Variables](#environment-variables)
5. [Two-Phase Callback Flow](#two-phase-callback-flow)
6. [Platform-Specific Guide](#platform-specific-guide)
   - [GitHub](#github)
   - [Google](#google)
   - [QQ](#qq)
   - [Facebook](#facebook)
   - [Weibo](#weibo)
   - [Twitter / X](#twitter--x)
   - [Huawei](#huawei)
   - [Steam](#steam)
   - [OIDC (Generic OpenID Connect)](#oidc-generic-openid-connect)
7. [API Endpoint Reference](#api-endpoint-reference)
8. [Response Examples](#response-examples)
9. [Error Handling](#error-handling)
10. [Database Persistence](#database-persistence)
11. [Internal Utilities](#internal-utilities)
12. [Best Practices & Security](#best-practices--security)
13. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The service is a lightweight [Koa](https://koajs.com/) application deployed as a Vercel Serverless Function. Every incoming request is routed to the matching provider module; provider modules all extend a shared `Base` class that handles the two-phase browser/server callback logic.

```
┌──────────────────────────────────────────────────────────┐
│                  Client / Browser                         │
│            (Waline, SPA, Static Site, …)                 │
└───────────────────────┬──────────────────────────────────┘
                        │  1. GET /<provider>?redirect=<cb>
                        ▼
┌──────────────────────────────────────────────────────────┐
│           oauth.lzc2002.top  (This Service)               │
│  ┌──────────────┐  ┌─────────────────────────────────┐   │
│  │  Koa Router  │  │       Base Class                 │   │
│  │  index.js    │  │  - Two-phase flow logic          │   │
│  │              │  │  - getCompleteUrl()              │   │
│  │              │  │  - formatUserResponse()          │   │
│  └──────┬───────┘  └───────────────┬─────────────────┘   │
│         │                          │ extends              │
│         │   ┌───────┬──────┬───────┼──────┬────────┐     │
│         │   │GitHub │Google│  QQ   │Weibo │Twitter │ …   │
│         │   └───────┴──────┴───────┴──────┴────────┘     │
│  ┌──────────────────────────────────────────────────┐     │
│  │        Response Formatter  (src/utils/response)  │     │
│  │  Validates id + name, normalizes all fields      │     │
│  └──────────────────────────────────────────────────┘     │
│  ┌──────────────────────────────────────────────────┐     │
│  │        Optional DB  (src/utils/storage/db)       │     │
│  │  Upserts user info into wl_3rd_info (background) │     │
│  └──────────────────────────────────────────────────┘     │
└───────────────────────┬──────────────────────────────────┘
                        │  2. Redirect to provider
                        ▼
             ┌──────────────────────┐
             │  OAuth Provider API  │
             │  (GitHub/Google/…)   │
             └──────────┬───────────┘
                        │  3. Callback with code
                        ▼
              oauth.lzc2002.top/<provider>
                        │
           ┌────────────┴──────────────┐
           │ redirect present?         │
           │ Yes → Browser phase       │ No → Server phase
           │ Forward code to your app  │ Exchange code → token → user JSON
           └───────────────────────────┘
```

---

## Unified Response Format

### Success Response

```json
{
  "id":       "string",          // Required — provider's unique user ID
  "name":     "string",          // Required — display name or username
  "email":    "string|undefined",// Optional — may be a synthesized placeholder
  "url":      "string|undefined",// Optional — profile page URL
  "avatar":   "string|undefined",// Optional — image URL or base64 data URI
  "platform": "string"           // Provider key (github, google, qq, …)
}
```

`id` and `name` are validated and will throw a `400` error if missing. All other fields are trimmed and set to `undefined` if empty.

### Error Response

```json
{
  "errno":   500,
  "message": "Descriptive error message"
}
```

The HTTP status code matches `errno`.

---

## Installation & Deployment

### Local Development

```bash
git clone https://github.com/walinejs/auth.git
cd auth
npm install

# Create your environment file
cp .env.local.example .env.local   # or create manually

npm start       # Uses `vercel dev` — serves at http://localhost:3000
```

### Deploy to Vercel

**One-click:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/walinejs/auth)

**Manual:**

```bash
npm install -g vercel
vercel          # follow prompts; set env vars in the Vercel dashboard
```

`vercel.json` routes all requests through `index.js`:

```json
{
  "version": 2,
  "builds": [{ "src": "index.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "/index.js" }]
}
```

---

## Environment Variables

| Variable | Provider | Required | Description |
|---|---|---|---|
| `SERVER_URL` | — | No | Override auto-detected base URL (e.g. `https://oauth.lzc2002.top`) |
| `POSTGRES_URL` | — | No | Vercel Postgres connection string; enables background DB writes |
| `GITHUB_ID` | GitHub | Cond. | GitHub OAuth App client ID |
| `GITHUB_SECRET` | GitHub | Cond. | GitHub OAuth App client secret |
| `GOOGLE_ID` | Google | Cond. | Google OAuth 2.0 client ID |
| `GOOGLE_SECRET` | Google | Cond. | Google OAuth 2.0 client secret |
| `QQ_ID` | QQ | Cond. | QQ Connect app ID |
| `QQ_SECRET` | QQ | Cond. | QQ Connect app secret |
| `FACEBOOK_ID` | Facebook | Cond. | Facebook App ID |
| `FACEBOOK_SECRET` | Facebook | Cond. | Facebook App Secret |
| `WEIBO_ID` | Weibo | Cond. | Weibo Open Platform app key |
| `WEIBO_SECRET` | Weibo | Cond. | Weibo Open Platform app secret |
| `TWITTER_ID` | Twitter/X | Cond. | Twitter OAuth 2.0 client ID |
| `TWITTER_SECRET` | Twitter/X | Cond. | Twitter OAuth 2.0 client secret |
| `HUAWEI_ID` | Huawei | Cond. | Huawei AGConnect OAuth client ID |
| `HUAWEI_SECRET` | Huawei | Cond. | Huawei AGConnect OAuth client secret |
| `STEAM_KEY` | Steam | Cond. | Steam Web API key (no secret needed) |
| `OIDC_ID` | OIDC | Cond. | OIDC client ID |
| `OIDC_SECRET` | OIDC | Cond. | OIDC client secret |
| `OIDC_ISSUER` | OIDC | Cond. | Issuer URL for auto-discovery |
| `OIDC_AUTH_URL` | OIDC | Cond. | Explicit authorization endpoint |
| `OIDC_TOKEN_URL` | OIDC | Cond. | Explicit token endpoint |
| `OIDC_USERINFO_URL` | OIDC | Cond. | Explicit userinfo endpoint |
| `OIDC_SCOPES` | OIDC | No | Space-separated scopes (default: `openid profile email`) |

`SERVER_URL` is optional because the service auto-detects the base URL from `x-forwarded-proto` / `x-forwarded-host` headers. Set it explicitly to avoid issues behind certain reverse proxies.

---

## Two-Phase Callback Flow

Most providers share a standard two-phase design implemented in `src/base.js`:

### Phase 1 — Authorization Redirect (Browser)

Your app sends the user's browser to:

```
GET https://oauth.lzc2002.top/<provider>?redirect=<callbackUrl>&state=<yourState>
```

The service redirects to the OAuth provider's authorization page. The `redirect` and `state` values are encoded into the OAuth `state` parameter so they survive the round-trip.

### Phase 2a — Browser Callback

The provider redirects back to `https://oauth.lzc2002.top/<provider>?code=<code>&state=<encodedState>`.

Because a `redirect` URL is present in the decoded state, the service **does not** exchange the code. Instead it redirects the browser to:

```
<callbackUrl>?code=<code>&state=<originalState>&type=<provider>
```

Your frontend now holds the `code`.

### Phase 2b — Server Token Exchange

Your backend (or Waline) calls the service directly with `User-Agent: @waline` (or `Accept: application/json`):

```
GET https://oauth.lzc2002.top/<provider>?code=<code>&state=<encodedState>
```

The service:
1. Extracts the PKCE verifier / redirect info from the encoded state
2. Exchanges the code for an access token with the provider
3. Fetches the user profile
4. Validates and normalizes the data
5. Optionally persists to PostgreSQL (background, non-blocking)
6. Returns the unified JSON user object

> **Twitter/X** is the only provider that overrides the base flow entirely — it uses `Accept: application/json` detection instead of `User-Agent: @waline`, and encodes state as base64url JSON rather than `querystring`.

---

## Platform-Specific Guide

### GitHub

**App Registration:** https://github.com/settings/oauth-apps

**Required env:** `GITHUB_ID`, `GITHUB_SECRET`

**Authorized callback URL in GitHub settings:**
```
https://oauth.lzc2002.top/github
```

**OAuth URLs:**
- Authorization: `https://github.com/login/oauth/authorize`
- Token: `https://github.com/login/oauth/access_token`
- User info: `https://api.github.com/user`
- Emails: `https://api.github.com/user/emails`

**Scopes requested:** `read:user,user:email`

**Notes:**
- If the user's primary email is not public, a second request is made to `/user/emails` to retrieve it.
- `url` is set to `userInfo.blog` (trimmed) if present; otherwise `https://github.com/<login>`.
- `id` uses the GitHub **login** (username), not the numeric ID.

**Flow:**
```
Browser → GET /github?redirect=<cb>&state=<s>
        → github.com/login/oauth/authorize
        → /github?code=X&state=redirect%3D<cb>%26state%3D<s>
        → <cb>?code=X&state=<s>&type=github

Server  → GET /github?code=X&state=<s>    (User-Agent: @waline)
        → JSON user object
```

---

### Google

**App Registration:** https://console.cloud.google.com/ → APIs & Services → Credentials → Create OAuth 2.0 Client ID

**Required env:** `GOOGLE_ID`, `GOOGLE_SECRET`

**Authorized redirect URI in Google Console:**
```
https://oauth.lzc2002.top/google
```

**OAuth URLs:**
- Authorization: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- User info: `https://www.googleapis.com/oauth2/v2/userinfo`

**Scopes requested:** `userinfo.email`, `userinfo.profile`

**Parameters:** `access_type=offline`, `prompt=consent` (ensures refresh token is issued)

**Notes:**
- `id` uses Google's numeric user ID string.
- `avatar` is the `picture` field from the userinfo response.
- The `state` parameter carries `redirect` and client `state` encoded via `querystring.stringify`.

---

### QQ

**App Registration:** https://connect.qq.com/

**Required env:** `QQ_ID`, `QQ_SECRET`

**Authorized callback URL:**
```
https://oauth.lzc2002.top/qq
```

**OAuth URLs:**
- Authorization: `https://graph.qq.com/oauth2.0/authorize`
- Token: `https://graph.qq.com/oauth2.0/token`
- OpenID: `https://graph.qq.com/oauth2.0/me`
- User info: `https://graph.qq.com/user/get_user_info`

**Parameters:** `fmt=json` added to both token and OpenID requests to receive JSON instead of JSONP.

**Notes:**
- `id` uses `unionid` if present; falls back to `openid`. `unionid` is stable across multiple QQ apps for the same developer account.
- `email` is not provided by QQ's API. A placeholder `<openid>@qq-uuid.com` is used.
- Avatar fields are tried in priority order: `figureurl_qq_2` → `figureurl_qq_1` → `figureurl_qq` → `figureurl_2` → `figureurl_1` → `figureurl`.
- Throws structured errors with codes from QQ's `errcode`/`ret` fields.

---

### Facebook

**App Registration:** https://developers.facebook.com/apps/

**Required env:** `FACEBOOK_ID`, `FACEBOOK_SECRET`

**Valid OAuth Redirect URI in Facebook App Dashboard:**
```
https://oauth.lzc2002.top/facebook
```

**OAuth URLs:**
- Authorization: `https://www.facebook.com/v4.0/dialog/oauth`
- Token: `https://graph.facebook.com/v4.0/oauth/access_token`
- User info: `https://graph.facebook.com/me`

**Fields requested:** `id`, `name`, `email`, `picture`, `link`

**Scopes:** `email`

**Notes:**
- Facebook uses `auth_type=rerequest` and `display=popup`.
- Avatar is extracted from the nested `picture.data.url` structure or from a plain string.
- `state` is encoded as `querystring.stringify({redirect, state})` and passed as a query param, not in the path.
- The `getUserInfo` override reads `state` from query params and handles the browser redirect itself.

---

### Weibo

**App Registration:** https://open.weibo.com/

**Required env:** `WEIBO_ID`, `WEIBO_SECRET`

**Authorized callback URL (must match exactly):**
```
https://oauth.lzc2002.top/weibo
```

**OAuth URLs:**
- Authorization: `https://api.weibo.com/oauth2/authorize`
- Token: `https://api.weibo.com/oauth2/access_token`
- Token info: `https://api.weibo.com/oauth2/get_token_info`
- User info: `https://api.weibo.com/2/users/show.json`

**Notes:**
- Weibo **does not return an email**. The `email` field is always `undefined`.
- Avatar is fetched server-side (with `Referer` and `User-Agent` headers to bypass hotlink protection) and returned as a **base64 data URI** (`data:image/jpeg;base64,...`). This can be large — be prepared to store or proxy it.
- `id` uses `idstr` (string version of the numeric Weibo UID).
- `url` is set to `userInfo.url` if provided, else `https://weibo.com/u/<uid>`.
- Uses native `fetch` (not `request-promise-native`) for HTTP calls.

---

### Twitter / X

**App Registration:** https://developer.twitter.com/en/portal/dashboard

**Required env:** `TWITTER_ID`, `TWITTER_SECRET`

**App Type:** Must be an **OAuth 2.0** app (not OAuth 1.0a). Enable "Read" permissions. Set the callback URL:

```
https://oauth.lzc2002.top/twitter
```

**OAuth URLs (X API v2):**
- Authorization: `https://x.com/i/oauth2/authorize`
- Token: `https://api.x.com/2/oauth2/token`
- User info: `https://api.x.com/2/users/me`

**Scopes requested:** `tweet.read`, `users.read`, `offline.access`, `users.email`

**PKCE:** This provider uses **PKCE with SHA-256** (RFC 7636). The code verifier and challenge are generated fresh for every authorization request. The verifier, along with `redirect`, `state`, and `callbackUrl`, is encoded as base64url JSON into the OAuth `state` parameter. No server-side session is required.

**Phase detection:** Instead of `User-Agent: @waline`, Twitter uses:
- `Accept: application/json` header → server phase (return JSON)
- `User-Agent: @waline` → server phase
- Otherwise → browser phase (redirect with code)

**Notes:**
- `email` uses `confirmed_email` field (requires `users.email` scope and app approval). Falls back to `<id>@twitter-uuid.com`.
- `avatar` is `profile_image_url` from the v2 users endpoint.
- Token exchange uses HTTP Basic Auth (`Authorization: Basic base64(clientId:clientSecret)`).

**Full flow:**
```
1. GET /twitter?redirect=<cb>&state=<s>
   → Generates PKCE pair, encodes state as base64url JSON
   → Redirects to x.com/i/oauth2/authorize?code_challenge=...&state=<encoded>

2. x.com → /twitter?code=X&state=<encoded>
   → Browser request: no Accept:application/json
   → Decodes state, extracts clientRedirect
   → Redirects to <cb>?code=X&state=<encoded>

3. Server → GET /twitter?code=X&state=<encoded>
   with Accept:application/json or User-Agent:@waline
   → Decodes state, extracts PKCE verifier
   → POST https://api.x.com/2/oauth2/token (Basic Auth + PKCE verifier)
   → GET https://api.x.com/2/users/me?user.fields=name,username,profile_image_url,...
   → Returns unified JSON
```

---

### Huawei

**App Registration:** https://developer.huawei.com/consumer/en/agconnect/auth-service/

**Required env:** `HUAWEI_ID`, `HUAWEI_SECRET`

**Callback URL:**
```
https://oauth.lzc2002.top/huawei
```

**OAuth URLs:**
- Authorization: `https://oauth-login.cloud.huawei.com/oauth2/v3/authorize`
- Token: `https://oauth-login.cloud.huawei.com/oauth2/v3/token`

**Scopes:** `openid profile email`

**Notes:**

Huawei does not expose a standard userinfo endpoint. User data is extracted by **decoding the `id_token` JWT** using the `jwt-decode` library (no signature verification — the token came directly from Huawei's token endpoint over HTTPS).

Fields mapped from JWT claims:

| JWT Claim | Response Field | Fallback |
|---|---|---|
| `sub` or `openid` | `id` | — |
| `display_name` / `nickname` / `name` / `sub` | `name` | — |
| `email` | `email` | `<sub>@huawei-uuid.com` |
| `picture` / `picture_url` | `avatar` | — |

**State-redirect bridge:** Because Huawei's callback does not carry the original `redirect` parameter, Huawei uses an **in-memory `Map`** keyed by `state` to store the `redirect` URL during the authorize step and retrieve it during token exchange. Entries expire after 10 minutes (cleaned up by a `setInterval`).

> ⚠️ **Multi-instance warning:** The in-memory map does not survive across Vercel function cold starts or multiple instances. For production deployments with multiple replicas, migrate the map to a shared store (Redis, KV, or the existing `POSTGRES_URL`).

---

### Steam

**API Key:** https://steamcommunity.com/dev/apikey

**Required env:** `STEAM_KEY` (no client secret needed)

**Return-to URL registered with Steam:**
Steam uses OpenID 2.0 — there is no OAuth app to register. The `openid.realm` is set to your site's origin, and `openid.return_to` is constructed dynamically.

**OpenID / API URLs:**
- OpenID endpoint: `https://steamcommunity.com/openid/login`
- Player summaries: `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/`

**Flow:**

Steam uses **OpenID 2.0**, not OAuth 2.0. There is no authorization code — instead Steam redirects back to your URL with a signed assertion that the server must verify by re-posting to the same endpoint with `openid.mode=check_authentication`.

```
1. GET /steam?redirect=<walineCallbackUrl>&state=<s>
   → Extracts inner redirect from the Waline callback URL's own ?redirect= param
   → Builds return_to = <walineCallback>?type=steam&redirect=<innerRedirect>&state=<s>
   → Redirects to steamcommunity.com/openid/login?openid.return_to=<return_to>...

2. Steam → <return_to>?openid.mode=id_res&openid.claimed_id=...
   → Your Waline instance calls GET /steam?openid.*=...
   → Service re-posts to steamcommunity.com with openid.mode=check_authentication
   → Verifies is_valid:true
   → Extracts SteamID from openid.claimed_id
   → GET https://api.steampowered.com/.../GetPlayerSummaries?steamids=<id>
   → Returns unified JSON
```

**Notes:**
- Steam provides no email. A placeholder `<steamId>@steam-uuid.com` is used.
- If `/steam` is visited without a `redirect` param (e.g. direct browser access), it returns a JSON status object instead of a 400 error.
- `avatar` is `avatarfull` from the player summary (184×184 px).
- `url` is `profileurl` from the player summary.

---

### OIDC (Generic OpenID Connect)

**Required env:** `OIDC_ID`, `OIDC_SECRET`, and either `OIDC_ISSUER` or all three of `OIDC_AUTH_URL` + `OIDC_TOKEN_URL` + `OIDC_USERINFO_URL`

**Discovery:** If `OIDC_ISSUER` is set, the service fetches `<issuer>/.well-known/openid-configuration` once on first use and caches the result in memory for the lifetime of the process.

**Manual endpoint override:** If `OIDC_AUTH_URL`, `OIDC_TOKEN_URL`, and `OIDC_USERINFO_URL` are all set, discovery is skipped entirely.

**Scopes:** Defaults to `openid profile email`; override with `OIDC_SCOPES`.

**Userinfo claim mapping:**

| Claim | Response Field |
|---|---|
| `sub` | `id` |
| `name` / `preferred_username` / `nickname` | `name` |
| `email` | `email` |
| `profile` / `website` / `url` | `url` |
| `picture` / `avatar` | `avatar` (backtick/quote-stripped) |

**Notes:**
- The `redirect_uri` sent to the OIDC provider is the `redirect` param passed from your application — OIDC providers do not use the service's own `/oidc` URL as the callback.
- `getUserInfo` includes robust state parsing: it handles multiple `state=` parameters in the query string and picks the one containing `redirect=`.
- Avatar values are sanitized to strip accidental surrounding backticks or quotes.

---

## API Endpoint Reference

### `GET /`

Returns service version and list of enabled providers.

**Response:**
```json
{
  "version": "1.2.0",
  "services": [
    { "name": "github", "origin": "github.com" }
  ]
}
```

---

### `GET /<provider>`

Handles both the authorization redirect (no `code`) and the callback (with `code`).

**Parameters (all via query string):**

| Parameter | Phase | Description |
|---|---|---|
| `code` | Callback | Authorization code from the OAuth provider |
| `state` | Both | Encoded state (contains `redirect` and original client `state`) |
| `redirect` | Initial | URL where the browser should be sent after provider callback |

**Behavior:**

| Condition | Action |
|---|---|
| No `code` | Redirect to provider authorization page |
| `code` present + `redirect` in state + browser request | Redirect browser to `<redirect>?code=<code>&state=<state>&type=<provider>` |
| `code` present + server request (`@waline` UA or `Accept: application/json`) | Exchange code → token → user info, return JSON |

---

## Response Examples

### GitHub

```json
{
  "id": "torvalds",
  "name": "Linus Torvalds",
  "email": "torvalds@linux-foundation.org",
  "url": "https://github.com/torvalds",
  "avatar": "https://avatars.githubusercontent.com/u/1024025?v=4",
  "platform": "github"
}
```

### Google

```json
{
  "id": "112233445566778899",
  "name": "Jane Smith",
  "email": "jane@gmail.com",
  "url": undefined,
  "avatar": "https://lh3.googleusercontent.com/a/...",
  "platform": "google"
}
```

### QQ

```json
{
  "id": "ABC123UNIONID",
  "name": "QQ用户",
  "email": "ABC123OPENID@qq-uuid.com",
  "url": undefined,
  "avatar": "https://thirdqq.qlogo.cn/g?b=oidb&k=...&s=100",
  "platform": "qq"
}
```

### Weibo

```json
{
  "id": "1234567890",
  "name": "微博用户",
  "email": undefined,
  "url": "https://weibo.com/u/1234567890",
  "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRgAB...",
  "platform": "weibo"
}
```

### Twitter/X

```json
{
  "id": "1234567890123456789",
  "name": "Example User",
  "email": "1234567890123456789@twitter-uuid.com",
  "url": "https://x.com/example",
  "avatar": "https://pbs.twimg.com/profile_images/.../photo.jpg",
  "platform": "twitter"
}
```

### Huawei

```json
{
  "id": "AT0000000123456789",
  "name": "Huawei User",
  "email": "AT0000000123456789@huawei-uuid.com",
  "url": undefined,
  "avatar": "https://upfile-drcn.platform.hicloud.com/...",
  "platform": "huawei"
}
```

### Steam

```json
{
  "id": "76561198012345678",
  "name": "SteamGamer",
  "email": "76561198012345678@steam-uuid.com",
  "url": "https://steamcommunity.com/id/steamgamer/",
  "avatar": "https://avatars.steamstatic.com/...full.jpg",
  "platform": "steam"
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning |
|---|---|
| 400 | Bad request — missing required parameters, invalid state |
| 401 | Unauthorized — token exchange failed or provider rejected credentials |
| 500 | Server error — network failure, provider API error |

### Error Response Body

```json
{
  "errno": 500,
  "message": "Error message from provider or validation layer"
}
```

### Provider-Specific Error Fields (Twitter)

Twitter errors include additional fields:

```json
{
  "error": "token_exchange_failed",
  "message": "...",
  "details": { ... }
}
```

### Validation Errors

If provider returns data without `id` or `name`, the service returns:

```json
{
  "errno": 400,
  "message": "User data validation failed: Missing or invalid platform UUID (id)"
}
```

---

## Database Persistence

If `POSTGRES_URL` is configured, the service performs a **background upsert** into the `wl_3rd_info` table after every successful authentication. This is non-blocking — it uses Vercel's `waitUntil()` to run after the response is sent.

### Schema

```sql
CREATE TABLE wl_3rd_info (
  platform   TEXT NOT NULL,
  id         TEXT NOT NULL,
  name       TEXT,
  email      TEXT,
  avatar     TEXT,
  url        TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (platform, id)
);
```

### Upsert Logic

```sql
INSERT INTO wl_3rd_info (platform, id, name, email, avatar, url, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
ON CONFLICT (platform, id) DO UPDATE SET
  name       = EXCLUDED.name,
  email      = EXCLUDED.email,
  avatar     = EXCLUDED.avatar,
  url        = EXCLUDED.url,
  updated_at = CURRENT_TIMESTAMP;
```

### OAuth Code Deduplication (Anti-Replay)

The database also provides deduplication for concurrent requests with the same `code`:

```sql
CREATE TABLE oauth_locks (
  code   TEXT PRIMARY KEY,
  result JSONB
);
```

- `claimOAuthCode(code)` — inserts the code; returns `false` on duplicate (PostgreSQL error 23505)
- `saveOAuthResult(code, result)` — stores the user JSON after successful exchange
- `getOAuthResult(code)` — retrieves a previously-saved result for a replayed code

---

## Internal Utilities

### `src/utils/response.js`

**`UserResponse` class** — wraps raw provider data; validates on `.get()`:

```js
const { createUserResponse } = require('./src/utils');
const response = createUserResponse({ id, name, email, url, avatar }, 'github');
const data = response.get(); // throws 400 if id or name missing
```

**`createErrorResponse(message, code)`** — builds `{ errno, message }`.

### `src/utils/validators.js`

| Function | Description |
|---|---|
| `isValidEmail(email)` | Regex-based email check |
| `isValidUrl(url)` | Uses `new URL()` — throws on invalid |
| `isValidId(id)` | Non-empty string check |
| `sanitizeUserData(data)` | Trims strings, removes nulls |
| `extractAvatar(picture)` | Handles string, `{url}`, `{data:{url}}` |
| `safeGet(obj, 'a.b.c', default)` | Null-safe deep property access |

### `src/base.js` — `Base` class

| Method | Description |
|---|---|
| `getCompleteUrl(path)` | Builds absolute URL using `SERVER_URL` or request headers |
| `formatUserResponse(userInfo, platform)` | Validates, normalizes, optionally persists, returns unified object |
| `getUserInfo()` | Shared two-phase flow (override in Twitter) |
| `redirect()` | Build provider authorization URL and redirect |
| `getAccessToken(code)` | Exchange code for token |
| `getUserInfoByToken(tokenInfo)` | Fetch and normalize user profile |

---

## Best Practices & Security

**CSRF Protection**
Pass a random `state` value from your application. The service preserves and returns it so you can verify it hasn't changed.

**PKCE**
Twitter/X already uses PKCE. For other providers, CSRF protection via `state` is the standard mitigation.

**Redirect URL Validation**
Validate the `redirect` parameter on your side before passing it to this service. The service does not whitelist redirect URLs — that is your application's responsibility.

**Sensitive Data in Avatar (Weibo)**
Weibo avatars are returned as base64 data URIs. These can be several hundred KB. Store them in object storage (S3, R2, etc.) or re-proxy them rather than saving raw in a database column.

**Huawei Multi-Instance**
The Huawei state-redirect bridge uses in-memory storage. If you deploy multiple Vercel function instances, move the map to a Redis or KV store to prevent redirect mismatches.

**POSTGRES_URL SSL**
The `db.js` storage module strips the `sslmode=` parameter from the connection string before creating the pool to avoid a known SSL handshake conflict with `@vercel/postgres`. Do not re-add it manually.

**Token Logging**
The service logs access tokens to console during development (`[Base.getUserInfo]` lines). Remove or redact these in production builds.

---

## Troubleshooting

### Provider not showing in `GET /`

The provider's `check()` method returned false — at least one required env variable is missing or empty. Verify variable names exactly (e.g. `TWITTER_ID` not `TWITTER_CLIENT_ID`).

### `redirect_uri_mismatch` from provider

The redirect URI registered in the provider's developer console must exactly match what the service sends. For most providers this is `https://<SERVER_URL>/<provider>` (no trailing slash, no query string). Exception: Facebook and QQ append query parameters to the redirect URI — register a wildcard or the base path only.

### Huawei: token exchange fails after successful browser redirect

The in-memory state map may have been cleared (cold start between authorize and token exchange). Ensure the token exchange happens within 10 minutes of authorization. For persistent deployments, migrate the map to a database.

### Weibo: empty avatar

Weibo's hotlink protection may block the server-side avatar fetch. The service sets `Referer` and `User-Agent` headers but this may not always be sufficient. In this case `avatar` will be `undefined`.

### Twitter: `invalid_state` error

The `state` parameter must be passed verbatim from step 1 to step 3. It is a base64url-encoded JSON object containing the PKCE verifier — do not decode, re-encode, or URL-encode it again.

### Steam: `Steam OpenID verification failed`

The OpenID `return_to` URL must be accessible from Steam's servers (i.e. publicly reachable, not `localhost`). Local development requires ngrok or a similar tunnel. Also ensure the `openid.*` query parameters are not modified by your proxy layer.

### QQ: `errcode` in response

QQ returns structured errors in JSON. The service wraps them as `[QQ API Error] <description>` or `[QQ Token Error] <description>`. Check QQ's developer documentation for the specific error code.
