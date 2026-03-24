# Technical Guide — Unified OAuth Authentication Service

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [One-Phase Flow with POST Delivery](#one-phase-flow-with-post-delivery)
3. [Unified Response Format](#unified-response-format)
4. [Installation & Deployment](#installation--deployment)
5. [Environment Variables](#environment-variables)
6. [Platform-Specific Guide](#platform-specific-guide)
7. [API Endpoint Reference](#api-endpoint-reference)
8. [Response Examples](#response-examples)
9. [Error Handling](#error-handling)
10. [Database Persistence](#database-persistence)
11. [Internal Utilities](#internal-utilities)
12. [Best Practices & Security](#best-practices--security)
13. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The service is a lightweight [Koa](https://koajs.com/) application deployed as a Vercel Serverless Function. All provider modules extend a shared `Base` class. The key design principles are:

1. **One-phase**: The auth service completes the full token exchange and user-info fetch itself.
2. **POST delivery**: User data is sent to the client via an auto-submitting HTML form POST, keeping all fields out of URLs and browser history.

```
┌──────────────────────────────────────────────────────────┐
│                  Client Browser                           │
└───────────────────────┬──────────────────────────────────┘
          │ 1. GET /<provider>?redirect=<cb>&state=<s>
          ▼
┌──────────────────────────────────────────────────────────┐
│               oauth.lzc2002.top                           │
│  2. 302 → provider authorization page                     │
│                                                           │
│  4. Provider callback arrives                             │
│     → exchange code/verify OpenID assertion               │
│     → fetch user profile                                  │
│     → validate & normalize                                │
│     → (optional) background DB upsert                    │
│  5. Serve auto-POST HTML page                             │
└───────────────────────┬──────────────────────────────────┘
          ▲ 3. code callback
          │
┌─────────┴────────────────────────────────────────────────┐
│              OAuth / OpenID Provider                      │
└──────────────────────────────────────────────────────────┘
          │ 6. Browser auto-POSTs form to <cb>
          ▼
┌──────────────────────────────────────────────────────────┐
│   Your Application  (<cb>)                                │
│   Receives: POST body with id, name, email, avatar, …    │
└──────────────────────────────────────────────────────────┘
```

---

## One-Phase Flow with POST Delivery

### Full sequence

**Step 1 — Initiate:**
```
GET https://oauth.lzc2002.top/<provider>?redirect=<yourCallback>&state=<csrfToken>
```

**Step 2** — Service redirects to provider authorization page.

**Step 3** — Provider redirects back to this service with an authorization code (or OpenID assertion for Steam). Your application is not involved.

**Step 4** — Service:
- Exchanges the code for an access token
- Fetches the user profile from the provider
- Validates (`id` and `name` required) and normalizes all fields

**Step 5** — Service responds with a tiny self-submitting HTML page:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Redirecting…</title></head>
<body>
<form id="f" method="POST" action="https://yourapp.com/auth/callback">
    <input type="hidden" name="id" value="torvalds">
    <input type="hidden" name="name" value="Linus Torvalds">
    <input type="hidden" name="email" value="torvalds@linux-foundation.org">
    <input type="hidden" name="url" value="https://github.com/torvalds">
    <input type="hidden" name="avatar" value="https://avatars.githubusercontent.com/...">
    <input type="hidden" name="platform" value="github">
    <input type="hidden" name="state" value="<yourCsrfToken>">
</form>
<script>document.getElementById('f').submit();</script>
</body>
</html>
```

**Step 6** — The browser instantly submits the form, delivering user data to your callback as a standard `application/x-www-form-urlencoded` POST body. The data never appears in a URL.

### Why POST and not redirect?

| Concern | GET redirect | POST form |
|---|---|---|
| Data in browser URL bar | ✅ visible | ❌ never |
| Data in browser history | ✅ stored | ❌ never |
| Data in server access logs | ✅ logged | ❌ never |
| Data in `Referer` header | ✅ leaked | ❌ never |
| Avatar / long fields truncated | ✅ possible | ❌ no URL length limit |
| Works without JavaScript | ❌ no | ✅ yes (form submits natively) |

The POST form approach is modeled after SAML's HTTP POST binding and is the standard pattern for delivering credentials between services via the browser.

### Handling the POST in your callback

Your callback endpoint must:
1. Accept `POST` requests
2. Parse `application/x-www-form-urlencoded` body (standard form parsing)
3. Verify the `state` field against your stored CSRF token
4. Check for an `error` field before reading user data

```js
// Express
app.use(express.urlencoded({ extended: false }));

app.post('/auth/callback/:provider', (req, res) => {
  const { error, state, id, name, email, url, avatar, platform } = req.body;

  if (error) return res.redirect(`/login?error=${encodeURIComponent(error)}`);
  if (state !== req.session.oauthState) return res.status(403).send('CSRF mismatch');

  // Use the user data
  req.session.user = { id, name, email, url, avatar, platform };
  res.redirect('/dashboard');
});
```

### Server-to-server (no redirect)

For server-side calls that don't involve a browser, omit the `redirect` parameter. The service returns a JSON body directly — no HTML form is involved:

```
GET https://oauth.lzc2002.top/<provider>?code=<code>&state=<state>
→ 200 OK
→ Content-Type: application/json
→ { "id": "...", "name": "...", ... }
```

---

## Unified Response Format

### POST body fields (browser flow)

Delivered as `application/x-www-form-urlencoded`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✅ | Provider's unique user ID |
| `name` | string | ✅ | Display name or username |
| `email` | string | ❌ | May be a synthesized placeholder |
| `url` | string | ❌ | Profile page URL |
| `avatar` | string | ❌ | Image URL or base64 data URI (Weibo) |
| `platform` | string | ✅ | `github` `google` `qq` `facebook` `weibo` `twitter` `huawei` `steam` `oidc` `microsoft-consumers` `microsoft-tenant` `microsoft-common` |
| `state` | string | ❌ | Your original CSRF token, returned verbatim |
| `error` | string | ❌ | Present only on failure; check this first |

### JSON body (server-to-server, no `redirect`)

```json
{
  "id":       "string",
  "name":     "string",
  "email":    "string|undefined",
  "url":      "string|undefined",
  "avatar":   "string|undefined",
  "platform": "string" // github, google, qq, facebook, weibo, twitter, huawei, steam, oidc, microsoft-consumers, microsoft-tenant, microsoft-common
}
```

### Error (server-to-server)

```json
{ "errno": 500, "message": "Descriptive error message" }
```

---

## Installation & Deployment

### Local Development

```bash
git clone https://github.com/walinejs/auth.git
cd auth
npm install
npm start       # http://localhost:3000
```

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/walinejs/auth)

```bash
npm install -g vercel && vercel
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SERVER_URL` | No | Override auto-detected base URL |
| `POSTGRES_URL` | No | Vercel Postgres — enables background DB upsert |
| `GITHUB_ID` / `GITHUB_SECRET` | For GitHub | OAuth App credentials |
| `GOOGLE_ID` / `GOOGLE_SECRET` | For Google | OAuth 2.0 credentials |
| `QQ_ID` / `QQ_SECRET` | For QQ | QQ Connect credentials |
| `FACEBOOK_ID` / `FACEBOOK_SECRET` | For Facebook | App credentials |
| `WEIBO_ID` / `WEIBO_SECRET` | For Weibo | Open Platform credentials |
| `TWITTER_ID` / `TWITTER_SECRET` | For Twitter/X | OAuth 2.0 + PKCE credentials |
| `HUAWEI_ID` / `HUAWEI_SECRET` | For Huawei | AGConnect credentials |
| `STEAM_KEY` | For Steam | Web API key (no secret needed) |
| `OIDC_ID` / `OIDC_SECRET` | For OIDC | Client credentials |
| `OIDC_ISSUER` | For OIDC | Issuer URL for auto-discovery |
| `OIDC_AUTH_URL` / `OIDC_TOKEN_URL` / `OIDC_USERINFO_URL` | For OIDC | Explicit endpoints (if no issuer) |
| `OIDC_SCOPES` | No | Scopes (default: `openid profile email`) |
| `MS_client_Id` / `MS_client_secret` | For Microsoft | Application credentials (required for all Microsoft endpoints) |
| `MS_tenant_Id` | For Microsoft Tenant | Azure AD tenant ID (required only for tenant endpoint) |

---

## Platform-Specific Guide

### GitHub

**Registration:** https://github.com/settings/developers
**Callback URL to register:** `https://oauth.lzc2002.top/github`  
**Scopes:** `read:user,user:email`

If the user's email is not public, a second request to `/user/emails` is made automatically. `id` uses the GitHub login string.

---

### Google

**Registration:** https://console.cloud.google.com/auth/overview → Credentials  
**Redirect URI to register:** `https://oauth.lzc2002.top/google`  
**Scopes:** `userinfo.email`, `userinfo.profile` (with `access_type=offline`, `prompt=consent`)

`redirect` is encoded into the OAuth `state` parameter (not the redirect URI), so Google only sees the plain `/google` callback.

---

### QQ

**Registration:** https://connect.qq.com/  
**Callback URL to register:** `https://oauth.lzc2002.top/qq`

Uses `unionid` when available, else `openid`. No email — placeholder `<openid>@qq-uuid.com` used. Avatar priority: `figureurl_qq_2` → `figureurl_qq_1` → `figureurl_qq` → `figureurl_2` → `figureurl_1` → `figureurl`.

---

### Facebook

**Registration:** https://developers.facebook.com/apps/  
**Redirect URI to register:** `https://oauth.lzc2002.top/facebook`  
**Fields:** `id`, `name`, `email`, `picture`, `link`. **Scopes:** `email`

---

### Weibo

**Registration:** https://open.weibo.com/  
**Callback URL (must match exactly):** `https://oauth.lzc2002.top/weibo`

No email. Avatar is fetched server-side and returned as a **base64 data URI** — can be several hundred KB. Store in object storage rather than a database column.

---

### Twitter / X

**Registration:** https://developer.twitter.com/  
**App type:** OAuth 2.0 with PKCE (not 1.0a)  
**Callback URL:** `https://oauth.lzc2002.top/twitter`  
**Scopes:** `tweet.read`, `users.read`, `offline.access`, `users.email`

Uses PKCE (RFC 7636, SHA-256). The verifier and client state are encoded as base64url JSON into the OAuth `state` — no server-side session needed. The original client `state` is unwrapped and returned to your callback.

Email requires `users.email` scope and Twitter app approval; falls back to `<id>@twitter-uuid.com`.

---

### Huawei

**Registration:** https://developer.huawei.com/consumer/en/agconnect/auth-service/  
**Callback URL:** `https://oauth.lzc2002.top/huawei`  
**Scopes:** `openid profile email`

User info is extracted by decoding the `id_token` JWT. Uses an in-memory `Map` (10-min TTL) to bridge authorize and token-exchange steps. For multi-instance deployments, migrate this to a shared Redis/KV store.

---

### Steam

**API Key:** https://steamcommunity.com/dev/apikey (no secret)  
**Protocol:** OpenID 2.0 — not OAuth

The service sets `openid.return_to` to its **own** `/steam` endpoint. Steam calls the service back, the service verifies the assertion and fetches the player summary, then POSTs user data to your callback. Your application **never sees any `openid.*` parameters**.

```
1. Browser  → GET /steam?redirect=<cb>&state=<s>
              Sets return_to = https://oauth.lzc2002.top/steam?redirect=<cb>&state=<s>
            → steamcommunity.com/openid/login

2. Steam    → /steam?openid.mode=id_res&openid.claimed_id=...
              Verifies is_valid:true
            → GET GetPlayerSummaries?steamids=<id>
              Serves auto-POST form

3. Browser  → POSTs to <cb>  with  id=76561...&name=...&platform=steam&state=<s>
```

No email from Steam — placeholder `<steamId>@steam-uuid.com` used. `openid.return_to` must be publicly reachable.

---

### OIDC (Generic OpenID Connect)

Supports auto-discovery via `OIDC_ISSUER` (fetches `/.well-known/openid-configuration` once, cached in memory) or manual endpoint configuration.

Userinfo claim mapping: `sub`→`id`, `name`/`preferred_username`/`nickname`→`name`, `email`→`email`, `profile`/`website`/`url`→`url`, `picture`/`avatar`→`avatar`.

The `redirect_uri` sent to the OIDC provider is the client's `redirect` param — whitelist it in your OIDC provider's allowed redirect URIs.

---

### Microsoft

**Registration:** https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade/ → App registrations 
 
**Callback URL to register:** `https://oauth.lzc2002.top/microsoft-consumers` (for personal accounts), `https://oauth.lzc2002.top/microsoft-tenant` (for organizational accounts), or `https://oauth.lzc2002.top/microsoft-common` (for both account types)  
**Scopes:** `openid profile email User.Read`

#### Microsoft Consumers (Personal Accounts)
- **Endpoint:** `/microsoft-consumers`
- **Environment variables:** `MS_client_Id`, `MS_client_secret`
- **Use case:** For personal Microsoft accounts (Outlook.com, Hotmail, etc.)

#### Microsoft Tenant (Organizational Accounts)
- **Endpoint:** `/microsoft-tenant`
- **Environment variables:** `MS_client_Id`, `MS_client_secret`, `MS_tenant_Id`
- **Use case:** For Azure AD organizational accounts

#### Microsoft Common (Both Account Types)
- **Endpoint:** `/microsoft-common`
- **Environment variables:** `MS_client_Id`, `MS_client_secret`
- **Use case:** For both personal and organizational accounts (recommended for most use cases)

**When to use each endpoint:**
- Use `/microsoft-common` if you want to support both personal and work/school accounts
- Use `/microsoft-consumers` if you only want to allow personal Microsoft accounts
- Use `/microsoft-tenant` if you only want to allow accounts from a specific Azure AD tenant

All endpoints use the Microsoft Graph API to fetch user profile information. For more details, see the [Microsoft Entra ID documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

---

## API Endpoint Reference

### `GET /`

Returns service version and active providers.

### `GET /<provider>`

| Condition | Action |
|---|---|
| No `code` / no `openid.mode` | Redirect browser to provider authorization page |
| Provider callback received | Complete exchange → serve auto-POST HTML → browser POSTs to `redirect` |
| No `redirect` param | Complete exchange → return JSON body directly |

**Query parameters:**

| Parameter | Description |
|---|---|
| `redirect` | Your POST callback URL (for browser flow) |
| `state` | Your CSRF token; returned in POST body |

---

## Response Examples

### GitHub (POST body received at your callback)

```
POST /auth/callback HTTP/1.1
Content-Type: application/x-www-form-urlencoded

id=torvalds&name=Linus+Torvalds&email=torvalds%40linux-foundation.org
&url=https%3A%2F%2Fgithub.com%2Ftorvalds
&avatar=https%3A%2F%2Favatars.githubusercontent.com%2Fu%2F1024025
&platform=github&state=abc123
```

### Steam (POST body)

```
POST /auth/callback HTTP/1.1
Content-Type: application/x-www-form-urlencoded

id=76561198012345678&name=SteamGamer
&email=76561198012345678%40steam-uuid.com
&url=https%3A%2F%2Fsteamcommunity.com%2Fid%2Fsteamgamer%2F
&avatar=https%3A%2F%2Favatars.steamstatic.com%2F...full.jpg
&platform=steam&state=abc123
```

### Error (POST body)

```
POST /auth/callback HTTP/1.1
Content-Type: application/x-www-form-urlencoded

error=Steam+OpenID+verification+failed&state=abc123
```

---

## Error Handling

| HTTP Code | Meaning |
|---|---|
| 400 | Missing required params or invalid state |
| 401 | Token exchange rejected by provider |
| 500 | Network failure or provider API error |

When a `redirect` is present and an error occurs, the error is delivered via the same POST form mechanism: `error=<message>&state=<state>` POSTed to your callback. Your app can check `req.body.error` in the same handler.

---

## Database Persistence

If `POSTGRES_URL` is set, a background upsert runs after every successful authentication (non-blocking via Vercel `waitUntil`).

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

---

## Internal Utilities

### `buildPostForm(action, fields)` (in `src/base.js`)

Generates the self-submitting HTML form. All field names and values are HTML-escaped to prevent injection. The form uses `method="POST"` and is submitted immediately via inline script.

### `src/base.js` — `Base` class

| Method | Description |
|---|---|
| `getCompleteUrl(path)` | Builds absolute URL from `SERVER_URL` or request headers |
| `formatUserResponse(userInfo, platform)` | Validates, normalizes, optionally persists |
| `getUserInfo()` | One-phase flow: exchange → fetch → POST form or JSON |
| `redirect()` | Build provider authorization URL and redirect |
| `getAccessToken(code)` | Exchange code for token (overridden per provider) |
| `getUserInfoByToken(tokenInfo)` | Fetch and normalize user profile (overridden per provider) |

### `src/utils/response.js`

`createUserResponse(rawData, platform)` — validates `id` and `name`, normalizes all fields.

### `src/utils/validators.js`

`isValidEmail`, `isValidUrl`, `isValidId`, `sanitizeUserData`, `extractAvatar`, `safeGet`.

---

## Best Practices & Security

**CSRF Protection** — Always pass a random `state` token. Verify it in your POST handler before using any other field.

**HTTPS Only** — The POST form delivers data via the browser; always use HTTPS on your callback endpoint to prevent interception.

**Redirect Validation** — Validate the `redirect` param on your side. The service does not whitelist callback URLs.

**Weibo Avatar Size** — Base64 avatars can be several hundred KB. Store in object storage.

**Huawei Multi-Instance** — Move the in-memory state bridge to Redis/KV for multi-replica deployments.

**Steam `openid.return_to`** — The service URL must be publicly reachable. `localhost` will not work.

**`SERVER_URL`** — Set this explicitly on Vercel to ensure `getCompleteUrl()` always produces the correct absolute URL regardless of which edge region handles the request.

---

## Troubleshooting

**Provider missing from `GET /`** — A required env variable is missing. Names are case-sensitive.

**`redirect_uri_mismatch`** — The callback URL registered in the provider's console must match exactly what the service sends (typically `https://<domain>/<provider>`, no trailing slash).

**Callback not receiving POST** — Ensure your route accepts `POST` and your framework parses `application/x-www-form-urlencoded`. In Express: `app.use(express.urlencoded({ extended: false }))`.

**Twitter: error on callback** — The PKCE state blob must round-trip unmodified. Do not re-encode it.

**Steam: `is_valid:true` not returned** — The service URL must be publicly reachable. Also verify `SERVER_URL` is set correctly so `return_to` resolves to the right absolute URL.

**Huawei: token exchange fails** — Cold start cleared the in-memory state map. Ensure exchange happens within 10 minutes of authorization, or use a shared store.

**Weibo: `avatar` is `undefined`** — Hotlink protection blocked the server-side fetch. Handle gracefully on the client.
