# Migration Guide — URL Query Params → POST Body Delivery

This guide covers migrating from the old URL query parameter delivery to the new HTTP POST body delivery.

## What Changed

### Old method (URL query params)

After provider login, the auth service redirected the browser to your callback with user data in the URL:

```
GET <yourCallback>?id=X&name=Y&email=Z&url=U&avatar=A&platform=github&state=<csrf>
```

### New method (POST body)

The auth service now serves a self-submitting HTML form that immediately POSTs to your callback. Your endpoint receives a standard `application/x-www-form-urlencoded` body:

```
POST <yourCallback>
Content-Type: application/x-www-form-urlencoded

id=X&name=Y&email=Z&url=U&avatar=A&platform=github&state=<csrf>
```

### Why the change?

The old GET redirect exposed user data in:
- The browser URL bar and history
- Server and proxy access logs
- `Referer` headers on subsequent navigations

Additionally, long fields (e.g. Weibo's base64 avatar data URIs) could exceed URL length limits. The POST form pattern keeps all user data out of URLs and is modeled after SAML's HTTP POST binding.

---

## Migration Steps

### 1. Change callback route: GET → POST

**Before:**
```js
app.get('/auth/callback', (req, res) => {
  const { id, name, email, state } = req.query;
});
```

**After:**
```js
app.use(express.urlencoded({ extended: false })); // add body parser

app.post('/auth/callback', (req, res) => {
  const { id, name, email, state } = req.body;
});
```

### 2. Read fields from `req.body` instead of `req.query`

| Field | Before | After |
|---|---|---|
| `id` | `req.query.id` | `req.body.id` |
| `name` | `req.query.name` | `req.body.name` |
| `email` | `req.query.email` | `req.body.email` |
| `url` | `req.query.url` | `req.body.url` |
| `avatar` | `req.query.avatar` | `req.body.avatar` |
| `platform` | `req.query.platform` | `req.body.platform` |
| `state` | `req.query.state` | `req.body.state` |
| `error` | `req.query.error` | `req.body.error` |

### 3. Add a body parser

| Framework | What to add |
|---|---|
| Express | `app.use(express.urlencoded({ extended: false }))` |
| Koa | `app.use(require('koa-body')())` |
| Next.js App Router | `const formData = await req.formData()` |
| Next.js Pages Router | Body parsing is built-in — no change needed |
| Django | `request.POST.get('id')` — no change needed |
| Laravel | `$request->input('id')` — no change needed |
| Rails | `params[:id]` — no change needed |

### 4. Handle errors

Error delivery also moved to the POST body. The field name is unchanged:

**Before:**
```js
if (req.query.error) {
  return res.redirect('/login?error=' + req.query.error);
}
```

**After:**
```js
if (req.body.error) {
  return res.redirect('/login?error=' + encodeURIComponent(req.body.error));
}
```

### 5. Update CSRF middleware if applicable

Since the callback is now a POST, some CSRF middleware may block it. Exclude the OAuth callback route and rely on the `state` param for CSRF protection instead:

**Express + csurf:**
```js
app.post('/auth/callback', csrfExclude, oauthCallbackHandler);
```

**Django:**
```python
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt  # state param handles CSRF
def oauth_callback(request): ...
```

---

## Framework-Specific Examples

### Express.js

**Before:**
```js
app.get('/auth/callback/:provider', (req, res) => {
  const { id, name, email, url, avatar, platform, state, error } = req.query;
  if (error) return res.redirect('/login?error=' + error);
  if (state !== req.session.oauthState) return res.status(403).send('Bad state');
  req.session.user = { id, name, email, url, avatar, platform };
  res.redirect('/dashboard');
});
```

**After:**
```js
app.use(express.urlencoded({ extended: false }));

app.post('/auth/callback/:provider', (req, res) => {
  const { id, name, email, url, avatar, platform, state, error } = req.body;
  if (error) return res.redirect('/login?error=' + encodeURIComponent(error));
  if (state !== req.session.oauthState) return res.status(403).send('Bad state');
  req.session.user = { id, name, email, url, avatar, platform };
  res.redirect('/dashboard');
});
```

### Next.js App Router

**Before:**
```js
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id    = searchParams.get('id');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  if (error) return Response.redirect('/login?error=' + error);
  // verify state, create session...
}
```

**After:**
```js
export async function POST(req) {
  const form  = await req.formData();
  const id    = form.get('id');
  const state = form.get('state');
  const error = form.get('error');
  if (error) return Response.redirect('/login?error=' + encodeURIComponent(error));
  // verify state, create session...
}
```

### SPA Popup Flow

Because the auth service now POSTs to the callback URL, a static HTML file can no longer intercept it. The callback must be a server-side route that:

1. Accepts the POST body
2. Packs the data into a short-lived signed token
3. Redirects the popup window to `/oauth-done?token=<token>`

The `/oauth-done` page then reads the token from the URL (not raw user data) and posts it back to the opener:

**Backend — POST /api/auth/callback/:provider:**
```js
app.post('/api/auth/callback/:provider', (req, res) => {
  const { id, name, email, url, avatar, platform, state, error } = req.body;
  const token = signShortLivedToken({ id, name, email, url, avatar, platform, state, error });
  res.redirect(`/oauth-done.html?token=${encodeURIComponent(token)}`);
});
```

**/oauth-done.html:**
```html
<!DOCTYPE html><html><body><script>
  const token = new URLSearchParams(location.search).get('token');
  const data  = verifyAndDecodeToken(token);
  window.opener?.postMessage({ type: 'oauth_callback', ...data }, location.origin);
  window.close();
</script></body></html>
```

---

## Checklist

- [ ] Callback route changed from `GET` to `POST`
- [ ] `urlencoded` body parser added (if using Express/Koa)
- [ ] All field reads updated: `req.query.*` → `req.body.*`
- [ ] Error check updated: `req.query.error` → `req.body.error`
- [ ] CSRF middleware excludes callback route (state param handles CSRF)
- [ ] SPA popup flow updated to use backend POST handler + redirect pattern
