# OAuth Center

A unified OAuth authentication service deployed at **https://oauth.lzc2002.top/**. Supports [GitHub][GitHub], [Twitter/X][Twitter], [Facebook][Facebook], [Google][Google], [Weibo][Weibo], [QQ][QQ], [Huawei][Huawei], [Steam][Steam], and any [OpenID Connect (OIDC)][OIDC] provider. Designed for [Waline](https://waline.js.org) comment systems and any web application that needs third-party login with a single, consistent API.

## ✨ Key Features

- 🔐 **9 Providers** — GitHub, Google, QQ, Facebook, Weibo, Twitter/X, Huawei, Steam, OIDC
- 🎯 **Unified Response Format** — All platforms return an identical JSON structure
- ✅ **Data Validation & Normalization** — Every response is validated before delivery
- 💾 **Optional DB Persistence** — Background upsert of user info into PostgreSQL (`wl_3rd_info` table)
- 🔒 **PKCE Support** — Twitter/X uses PKCE (RFC 7636) for enhanced security; no server-side session needed
- 🚀 **Serverless Ready** — One-click deploy to Vercel

## Live Service

The public instance runs at **https://oauth.lzc2002.top/**.

`GET /` returns the service version and every currently-active provider:

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

A provider only appears when its required environment variables are configured. Facebook and OIDC are implemented but not active on the public instance.

## Unified Response Format

All providers return user data in this structure:

```json
{
  "id": "platform-uuid",
  "name": "Display Name",
  "email": "user@example.com",
  "url": "https://profile-url",
  "avatar": "https://avatar-url",
  "platform": "github"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✅ | Unique identifier from the provider |
| `name` | string | ✅ | Display name or username |
| `email` | string | ❌ | Omitted if unavailable; QQ, Twitter, Steam use a synthesized placeholder |
| `url` | string | ❌ | Profile page URL |
| `avatar` | string | ❌ | Avatar URL or base64 data URI (Weibo) |
| `platform` | string | ❌ | Provider key: `github` `google` `qq` `facebook` `weibo` `twitter` `huawei` `steam` `oidc` |

Error responses follow:

```json
{ "errno": 400, "message": "Descriptive error message" }
```

## Deploy Your Own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/walinejs/auth)

Or run locally:

```bash
git clone https://github.com/walinejs/auth.git
cd auth
npm install
npm start    # http://localhost:3000
```

## Environment Variables

Only set the variables for providers you want to enable. Unset providers are silently skipped.

```env
# Optional — overrides auto-detected server base URL
SERVER_URL=https://oauth.lzc2002.top

# Optional — Vercel Postgres connection string
# Enables background upsert into the wl_3rd_info table
POSTGRES_URL=postgres://...

# ── GitHub ──────────────────────────────────────────────────────────
# https://github.com/settings/oauth-apps
GITHUB_ID=your_github_client_id
GITHUB_SECRET=your_github_client_secret

# ── Google ──────────────────────────────────────────────────────────
# https://console.cloud.google.com/ → APIs & Services → Credentials
GOOGLE_ID=your_client_id.apps.googleusercontent.com
GOOGLE_SECRET=your_google_client_secret

# ── QQ ──────────────────────────────────────────────────────────────
# https://connect.qq.com/
QQ_ID=your_qq_app_id
QQ_SECRET=your_qq_app_secret

# ── Facebook ────────────────────────────────────────────────────────
# https://developers.facebook.com/apps/
FACEBOOK_ID=your_facebook_app_id
FACEBOOK_SECRET=your_facebook_app_secret

# ── Weibo ───────────────────────────────────────────────────────────
# https://open.weibo.com/
WEIBO_ID=your_weibo_app_id
WEIBO_SECRET=your_weibo_app_secret

# ── Twitter / X ─────────────────────────────────────────────────────
# https://developer.twitter.com/en/portal/dashboard
# Must be an OAuth 2.0 app (not 1.0a), with PKCE enabled
TWITTER_ID=your_twitter_client_id
TWITTER_SECRET=your_twitter_client_secret

# ── Huawei ──────────────────────────────────────────────────────────
# https://developer.huawei.com/consumer/en/agconnect/auth-service/
HUAWEI_ID=your_huawei_client_id
HUAWEI_SECRET=your_huawei_client_secret

# ── Steam ───────────────────────────────────────────────────────────
# https://steamcommunity.com/dev/apikey
STEAM_KEY=your_steam_web_api_key

# ── OIDC (Generic OpenID Connect) ───────────────────────────────────
OIDC_ID=your_oidc_client_id
OIDC_SECRET=your_oidc_client_secret
# Option A — issuer URL (auto-discovers /.well-known/openid-configuration)
OIDC_ISSUER=https://your-provider.example.com
# Option B — explicit endpoints (if discovery is unavailable)
# OIDC_AUTH_URL=https://your-provider.example.com/authorize
# OIDC_TOKEN_URL=https://your-provider.example.com/token
# OIDC_USERINFO_URL=https://your-provider.example.com/userinfo
# Optional: space-separated scopes (default: "openid profile email")
# OIDC_SCOPES=openid profile email
```

## Provider Quick Reference

| Provider | Redirect URL | Notes |
|---|---|---|
| GitHub | `/<server>/github?redirect=<cb>&state=<s>` | Fetches email separately if not public |
| Google | `/<server>/google?redirect=<cb>&state=<s>` | Requests `userinfo.email` + `userinfo.profile` |
| QQ | `/<server>/qq?redirect=<cb>&state=<s>` | Uses `unionid` when available, else `openid` |
| Facebook | `/<server>/facebook?redirect=<cb>&state=<s>` | Requests `id,name,email,picture,link` |
| Weibo | `/<server>/weibo?redirect=<cb>&state=<s>` | No email; avatar returned as base64 |
| Twitter/X | `/<server>/twitter?redirect=<cb>&state=<s>` | OAuth 2.0 + PKCE; state is base64url-encoded |
| Huawei | `/<server>/huawei?redirect=<cb>&state=<s>` | User info from `id_token` JWT |
| Steam | `/<server>/steam?redirect=<cb>&state=<s>` | OpenID 2.0; no email provided |
| OIDC | `/<server>/oidc?redirect=<cb>&state=<s>` | Supports auto-discovery |

## Two-Phase Callback Flow

Most providers follow this pattern:

**Browser phase** — OAuth provider redirects back to this service. If a `redirect` parameter is present, the service appends `?code=<code>&state=<state>` to that URL and sends the browser there. Your application then holds the `code`.

**Server phase** — Your server calls this service again with `code` (and no `redirect`), or sends `User-Agent: @waline` / `Accept: application/json`. The service exchanges the code for a token, fetches user info, and returns the unified JSON.

```
Browser: Provider ──▶ oauth.lzc2002.top/<provider> ──▶ yourapp?code=X&state=Y ──▶ Your UI
Server:  Your backend ──▶ GET oauth.lzc2002.top/<provider>?code=X ──▶ JSON user object
```

See [TECHNICAL_GUIDE.md](./TECHNICAL_GUIDE.md) for per-provider flow diagrams and edge cases.

## Complete Documentation

📖 **[Technical Guide](./TECHNICAL_GUIDE.md)** — Full platform setup, flow diagrams, API reference, error codes, and database schema.

💡 **[Integration Examples](./INTEGRATION_EXAMPLES.js)** — Ready-to-use code for Express.js, Next.js, vanilla browser JS, and Waline.

[GitHub]: https://github.com/settings/oauth-apps
[Twitter]: https://developer.twitter.com/
[Facebook]: https://developers.facebook.com/
[Google]: https://console.cloud.google.com/
[Weibo]: https://open.weibo.com/
[QQ]: https://connect.qq.com/
[Huawei]: https://developer.huawei.com/
[Steam]: https://steamcommunity.com/dev/apikey
[OIDC]: https://openid.net/connect/
