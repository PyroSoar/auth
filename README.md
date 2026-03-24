# OAuth Center

A unified OAuth authentication service deployed at **https://oauth.lzc2002.top/**. Supports [GitHub][GitHub], [Twitter/X][Twitter], [Facebook][Facebook], [Google][Google], [Weibo][Weibo], [QQ][QQ], [Huawei][Huawei], [Steam][Steam], and any [OpenID Connect (OIDC)][OIDC] provider. Designed for [Waline](https://waline.js.org) comment systems and any web application that needs third-party login.

## ✨ Key Features

- 🔐 **9 Providers** — GitHub, Google, QQ, Facebook, Weibo, Twitter/X, Huawei, Steam, OIDC
- 🎯 **Unified Response Format** — All platforms deliver an identical JSON structure
- ⚡ **True One-Phase Flow** — The service completes the full token exchange; your callback receives user data immediately
- 📬 **POST Body Delivery** — User data is delivered via HTTP POST (not URL query params), keeping sensitive fields out of browser history and server logs
- ✅ **Data Validation & Normalization** — Every response is validated before delivery
- 💾 **Optional DB Persistence** — Background upsert into PostgreSQL (`wl_3rd_info`)
- 🔒 **PKCE Support** — Twitter/X uses PKCE (RFC 7636)
- 🚀 **Serverless Ready** — One-click deploy to Vercel

## Live Service

`GET https://oauth.lzc2002.top/` returns the service version and active providers:

```json
{
  "version": "1.2.0",
  "services": [
    { "name": "github",  "origin": "github.com" },
    { "name": "weibo",   "origin": "api.weibo.com" },
    { "name": "twitter", "origin": "x.com" },
    { "name": "google",  "origin": "accounts.google.com" },
    { "name": "qq",      "origin": "graph.qq.com" },
    { "name": "huawei",  "origin": "oauth-login.cloud.huawei.com" },
    { "name": "steam",   "origin": "api.steampowered.com" }
  ]
}
```

## How It Works

### One-Phase Flow

```
1. Your app  →  GET https://oauth.lzc2002.top/<provider>?redirect=<yourCallback>&state=<csrf>
2. Service   →  Redirects browser to provider login page
3. Provider  →  Redirects back to service (invisible to your app)
4. Service   →  Exchanges code, fetches user profile, validates data
5. Service   →  Serves an auto-submitting HTML form that POSTs user data to <yourCallback>
6. Browser   →  POSTs to <yourCallback> — your app receives user data as a JSON body
```

### Why POST instead of redirect?

User data (name, email, avatar URL) would otherwise appear in the browser's URL bar, history, and server access logs. The service instead serves a tiny self-submitting HTML form that immediately POSTs the payload to your callback endpoint — the data never touches the URL.

### What your callback receives

Your callback endpoint receives a standard `application/x-www-form-urlencoded` POST body:

```
id=<id>&name=<name>&email=<email>&url=<url>&avatar=<avatar>&platform=<platform>&state=<csrf>
```

Parse it exactly like any other HTML form submission. In Express:

```js
app.use(express.urlencoded({ extended: false }));

app.post('/auth/callback/:provider', (req, res) => {
  const { id, name, email, url, avatar, platform, state } = req.body;
  // verify state, then use the data
});
```

### Error delivery

On error, the service POSTs `error=<message>&state=<csrf>` to your callback. Check for the `error` field first.

### Server-to-server (no redirect)

Omit the `redirect` parameter entirely. The service returns a JSON body directly:

```json
{ "id": "...", "name": "...", "email": "...", "url": "...", "avatar": "...", "platform": "..." }
```

## Unified Response Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✅ | Unique identifier from the provider |
| `name` | string | ✅ | Display name or username |
| `email` | string | ❌ | May be a synthesized placeholder for QQ, Twitter, Steam |
| `url` | string | ❌ | Profile page URL |
| `avatar` | string | ❌ | Avatar URL, or base64 data URI for Weibo |
| `platform` | string | ❌ | `github` `google` `qq` `facebook` `weibo` `twitter` `huawei` `steam` `oidc` |
| `state` | string | ❌ | Your original CSRF token, returned verbatim |

## Deploy Your Own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/walinejs/auth)

```bash
git clone https://github.com/walinejs/auth.git
cd auth && npm install && npm start
```

## Environment Variables

```env
SERVER_URL=https://oauth.lzc2002.top   # Optional — override auto-detected base URL
POSTGRES_URL=postgres://...             # Optional — enables background DB upsert

GITHUB_ID=...   GITHUB_SECRET=...
GOOGLE_ID=...   GOOGLE_SECRET=...
QQ_ID=...       QQ_SECRET=...
FACEBOOK_ID=... FACEBOOK_SECRET=...
WEIBO_ID=...    WEIBO_SECRET=...
TWITTER_ID=...  TWITTER_SECRET=...     # OAuth 2.0 + PKCE app
HUAWEI_ID=...   HUAWEI_SECRET=...
STEAM_KEY=...                           # No secret needed (OpenID 2.0)

# OIDC — either issuer (for auto-discovery) or explicit endpoints
OIDC_ID=...     OIDC_SECRET=...
OIDC_ISSUER=https://your-provider.example.com
# OIDC_AUTH_URL=...  OIDC_TOKEN_URL=...  OIDC_USERINFO_URL=...
# OIDC_SCOPES=openid profile email
```

## Provider Notes

**Weibo** — No email. Avatar is a base64 data URI (can be several hundred KB).

**Twitter/X** — PKCE with SHA-256. Email requires `users.email` scope approval; falls back to `<id>@twitter-uuid.com`.

**Steam** — OpenID 2.0, not OAuth. Service sets `openid.return_to` to itself, completes verification internally, then POSTs to your callback. Your app never sees any `openid.*` params.

**Huawei** — User info from JWT `id_token`. Uses an in-memory state bridge (10-min TTL); multi-instance deployments need a shared store.

**QQ** — No email; placeholder `<openid>@qq-uuid.com`. Prefers `unionid` over `openid`.

## Complete Documentation

📖 **[Technical Guide](./TECHNICAL_GUIDE.md)** — Full platform setup, POST delivery details, API reference, database schema.

💡 **[Integration Examples](./INTEGRATION_EXAMPLES.js)** — Ready-to-use code for Express.js, Next.js, and browser JS.

🔄 **[Migration Guide](./MIGRATION.md)** — Upgrading from URL query param delivery to POST body delivery.

[GitHub]: https://github.com/settings/oauth-apps
[Twitter]: https://developer.twitter.com/
[Facebook]: https://developers.facebook.com/
[Google]: https://console.cloud.google.com/
[Weibo]: https://open.weibo.com/
[QQ]: https://connect.qq.com/
[Huawei]: https://developer.huawei.com/
[Steam]: https://steamcommunity.com/dev/apikey
[OIDC]: https://openid.net/connect/
