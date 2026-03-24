/**
 * Unified OAuth Authentication Service — Integration Examples
 *
 * Live service: https://oauth.lzc2002.top/
 *
 * DELIVERY MODEL: User data is delivered via HTTP POST (not URL query params).
 * The auth service serves a self-submitting HTML form that POSTs to your
 * callback URL. Your callback receives an application/x-www-form-urlencoded
 * body — parse it like any standard HTML form submission.
 *
 * Flow:
 *   1. Send browser to  GET /github?redirect=<yourCallback>&state=<csrf>
 *   2. Auth service handles provider login + token exchange
 *   3. Browser POSTs to <yourCallback> with body:
 *        id=X&name=Y&email=Z&url=U&avatar=A&platform=github&state=<csrf>
 *
 * Supported providers:
 *   github, google, qq, facebook, weibo, twitter, huawei, steam, oidc
 */

const AUTH_SERVICE = 'https://oauth.lzc2002.top';

// ==============================================================================
// Example 1: Express.js — Full Integration
// ==============================================================================

const express = require('express');
const session = require('express-session');
const crypto  = require('crypto');

const app = express();

// Required: parse the POST body the auth service sends to your callback
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

const VALID_PROVIDERS = [
  'github', 'google', 'qq', 'facebook', 'weibo',
  'twitter', 'huawei', 'steam', 'oidc'
];

/**
 * Step 1 — Initiate login.
 * GET /auth/login/github
 *
 * Redirects browser to the auth service, which redirects to the provider.
 * After login the auth service POSTs user data to /auth/callback/:provider.
 */
app.get('/auth/login/:provider', (req, res) => {
  const { provider } = req.params;
  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `Unknown provider "${provider}"` });
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  // The auth service will POST user data to this URL
  const callbackUrl = `${process.env.SERVER_URL}/auth/callback/${provider}`;

  const authUrl = new URL(`${AUTH_SERVICE}/${provider}`);
  authUrl.searchParams.set('redirect', callbackUrl);
  authUrl.searchParams.set('state', state);

  res.redirect(authUrl.toString());
});

/**
 * Step 2 — Receive user data via POST.
 * POST /auth/callback/github
 *
 * Body (application/x-www-form-urlencoded):
 *   id, name, email, url, avatar, platform, state
 *   — or —
 *   error, state
 */
app.post('/auth/callback/:provider', (req, res) => {
  const { error, state, id, name, email, url, avatar, platform } = req.body;

  // Forward errors from the auth service
  if (error) {
    return res.redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  // CSRF check
  if (!state || state !== req.session.oauthState) {
    return res.status(403).send('CSRF state mismatch');
  }
  delete req.session.oauthState;

  // User data is ready — store in session or database
  req.session.user = { id, name, email, url, avatar, platform };
  res.redirect('/dashboard');
});

app.get('/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.session.user);
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// app.listen(3000);


// ==============================================================================
// Example 2: Next.js App Router — API Routes
// ==============================================================================

// app/api/auth/login/[provider]/route.js
export async function GET_NextLogin(req, { params }) {
  const { provider } = params;
  const state = crypto.randomUUID();

  // Callback that will receive the POST body
  const callbackUrl = `${process.env.NEXT_PUBLIC_URL}/api/auth/callback/${provider}`;

  const authUrl = new URL(`${AUTH_SERVICE}/${provider}`);
  authUrl.searchParams.set('redirect', callbackUrl);
  authUrl.searchParams.set('state', state);

  const response = Response.redirect(authUrl.toString(), 302);
  response.headers.set('Set-Cookie',
    `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  return response;
}

// app/api/auth/callback/[provider]/route.js
export async function POST_NextCallback(req, { params }) {
  // Parse the urlencoded POST body from the auth service
  const formData  = await req.formData();
  const error     = formData.get('error');
  const state     = formData.get('state');
  const id        = formData.get('id');
  const name      = formData.get('name');
  const email     = formData.get('email');
  const avatar    = formData.get('avatar');
  const platform  = formData.get('platform');

  if (error) {
    return Response.redirect(
      `${process.env.NEXT_PUBLIC_URL}/login?error=${encodeURIComponent(error)}`
    );
  }

  const cookieState = req.cookies.get('oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return Response.json({ error: 'State mismatch' }, { status: 403 });
  }

  // Create session with user data
  const userData = { id, name, email, avatar, platform };
  // const sessionToken = await createSession(userData);

  const response = Response.redirect(
    `${process.env.NEXT_PUBLIC_URL}/dashboard`, 302
  );
  response.headers.append('Set-Cookie', `oauth_state=; Path=/; Max-Age=0`);
  // response.headers.append('Set-Cookie', `session=${sessionToken}; Path=/; HttpOnly`);
  return response;
}


// ==============================================================================
// Example 3: Vanilla Browser JavaScript — Popup Flow
// ==============================================================================

/**
 * Opens a popup for OAuth login.
 *
 * The auth service POSTs to the callback page (oauth-callback.html), which reads
 * the POST body via a form and forwards the data to the opener via postMessage.
 *
 * Note: The callback page must use a form with JS to read POST body fields,
 * since browsers don't expose POST bodies directly to window.location parsing.
 */
class OAuthPopup {
  constructor(authServiceUrl = AUTH_SERVICE) {
    this.authServiceUrl = authServiceUrl;
  }

  /**
   * @param {'github'|'google'|'qq'|'facebook'|'weibo'|'twitter'|'huawei'|'steam'|'oidc'} provider
   * @returns {Promise<{id, name, email, url, avatar, platform}>}
   */
  login(provider) {
    return new Promise((resolve, reject) => {
      const state       = crypto.randomUUID();
      const callbackUrl = `${location.origin}/oauth-callback.html`;

      sessionStorage.setItem('oauth_state', state);

      const authUrl = new URL(`${this.authServiceUrl}/${provider}`);
      authUrl.searchParams.set('redirect', callbackUrl);
      authUrl.searchParams.set('state', state);

      const popup = window.open(authUrl.toString(), 'oauth_popup',
        'width=520,height=640,menubar=no,toolbar=no');
      if (!popup) { reject(new Error('Popup blocked')); return; }

      const onMessage = (event) => {
        if (event.origin !== location.origin) return;
        if (!event.data || event.data.type !== 'oauth_callback') return;
        window.removeEventListener('message', onMessage);
        clearInterval(pollClose);

        const savedState = sessionStorage.getItem('oauth_state');
        sessionStorage.removeItem('oauth_state');

        if (event.data.state !== savedState) {
          reject(new Error('CSRF state mismatch'));
          return;
        }
        if (event.data.error) {
          reject(new Error(event.data.error));
          return;
        }

        resolve({
          id:       event.data.id,
          name:     event.data.name,
          email:    event.data.email,
          url:      event.data.url,
          avatar:   event.data.avatar,
          platform: event.data.platform,
        });
      };

      window.addEventListener('message', onMessage);

      const pollClose = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollClose);
          window.removeEventListener('message', onMessage);
          sessionStorage.removeItem('oauth_state');
          reject(new Error('Login popup closed'));
        }
      }, 500);
    });
  }
}

/**
 * oauth-callback.html
 * ─────────────────────────────────────────────────────────────────────────────
 * This page receives the POST from the auth service. Since it's a POST, we
 * can't read the body from JS directly — instead we embed the values as hidden
 * inputs (the auth service already put them there) and read them via the DOM,
 * then forward to the opener.
 *
 * The auth service's POST form already targets this URL, so the browser
 * renders this page with the form fields in the document. We read those values
 * using a second <form> trick, or more simply by having the page be a form
 * target itself that exposes field values via document.forms or named inputs.
 *
 * Simplest approach: make this page a form action endpoint on your own backend
 * that sets a short-lived cookie and redirects to a tiny JS page.
 *
 * Alternative: use a server-rendered callback page (see Example 1 / Example 2)
 * — this is the recommended approach for most apps. The popup flow works best
 * for pure client-side SPAs with a small backend shim.
 *
 * If you control the callback server, the recommended popup flow is:
 *   1. Backend receives POST, stores user data in a short-lived signed token
 *   2. Redirects popup to /oauth-done?token=<signedToken>
 *   3. /oauth-done.html reads token from URL, postMessages it to opener
 *
 * <!DOCTYPE html><html><body><script>
 *   const p = new URLSearchParams(location.search);
 *   // token was set by your backend redirect
 *   window.opener?.postMessage({
 *     type:     'oauth_callback',
 *     state:    p.get('state'),
 *     error:    p.get('error'),
 *     id:       p.get('id'),
 *     name:     p.get('name'),
 *     email:    p.get('email'),
 *     url:      p.get('url'),
 *     avatar:   p.get('avatar'),
 *     platform: p.get('platform'),
 *   }, location.origin);
 *   window.close();
 * </script></body></html>
 */

// Usage:
// const oauth = new OAuthPopup();
// const user  = await oauth.login('github');
// console.log(user.name, user.platform);


// ==============================================================================
// Example 4: React Hook — useOAuth (with backend callback route)
// ==============================================================================

// import { useState, useCallback } from 'react';

/**
 * useOAuth — opens a popup, waits for backend to process the POST callback
 * and signal completion via postMessage.
 *
 * Your backend POST callback route should:
 *   1. Receive the urlencoded POST body from the auth service
 *   2. Verify state, create session
 *   3. Redirect the popup to /oauth-done?id=X&name=Y&... (or a signed token)
 *
 * /oauth-done.html posts back to opener and closes.
 */
function useOAuth(authServiceUrl = AUTH_SERVICE) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const login = useCallback((provider) => {
    setLoading(true);
    setError(null);

    const state       = crypto.randomUUID();
    // This backend route accepts POST, processes it, then redirects popup to /oauth-done
    const callbackUrl = `${location.origin}/api/auth/callback/${provider}`;

    sessionStorage.setItem('oauth_state', state);

    const authUrl = new URL(`${authServiceUrl}/${provider}`);
    authUrl.searchParams.set('redirect', callbackUrl);
    authUrl.searchParams.set('state', state);

    const popup = window.open(authUrl.toString(), 'oauth', 'width=520,height=640');

    const onMessage = (event) => {
      if (event.origin !== location.origin) return;
      if (event.data?.type !== 'oauth_callback') return;
      window.removeEventListener('message', onMessage);

      const savedState = sessionStorage.getItem('oauth_state');
      sessionStorage.removeItem('oauth_state');

      if (event.data.state !== savedState) {
        setError('CSRF state mismatch');
        setLoading(false);
        return;
      }
      if (event.data.error) {
        setError(event.data.error);
        setLoading(false);
        return;
      }

      setUser({
        id: event.data.id, name: event.data.name,
        email: event.data.email, avatar: event.data.avatar,
        platform: event.data.platform,
      });
      setLoading(false);
    };

    window.addEventListener('message', onMessage);
  }, [authServiceUrl]);

  const logout = useCallback(() => setUser(null), []);
  return { user, loading, error, login, logout };
}


// ==============================================================================
// Example 5: Utility — parseOAuthPost
// ==============================================================================

/**
 * Parse the POST body received from the auth service in a generic handler.
 * Works with any framework that exposes body fields as an object.
 *
 * @param {object} body       - Parsed request body (e.g. req.body in Express)
 * @param {string} savedState - The CSRF state you stored before initiating login
 * @returns {{ user: object } | { error: string }}
 */
function parseOAuthPost(body, savedState) {
  if (body.error) {
    return { error: body.error };
  }
  if (!body.state || body.state !== savedState) {
    return { error: 'CSRF state mismatch' };
  }
  return {
    user: {
      id:       body.id       || null,
      name:     body.name     || null,
      email:    body.email    || undefined,
      url:      body.url      || undefined,
      avatar:   body.avatar   || undefined,
      platform: body.platform || null,
    }
  };
}

// Usage:
// app.post('/auth/callback/:provider', (req, res) => {
//   const result = parseOAuthPost(req.body, req.session.oauthState);
//   if (result.error) return res.redirect('/login?error=' + result.error);
//   req.session.user = result.user;
//   res.redirect('/dashboard');
// });


// ==============================================================================
// Example 6: Check available providers
// ==============================================================================

async function getAvailableProviders() {
  const res  = await fetch(AUTH_SERVICE);
  const data = await res.json();
  return data.services.map(s => s.name);
  // e.g. ['github', 'weibo', 'twitter', 'google', 'qq', 'huawei', 'steam']
}


// ==============================================================================
// Example 7: Server-to-server (no browser, no redirect)
// ==============================================================================

/**
 * For server-side integrations where you already have a code and state
 * (e.g. a mobile app that handled the provider redirect natively),
 * call the auth service directly without a redirect param.
 * The service returns JSON — no HTML form is involved.
 */
async function exchangeCodeForUser({ provider, code, state }) {
  const url = new URL(`${AUTH_SERVICE}/${provider}`);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  const res  = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok || data.errno) {
    throw Object.assign(
      new Error(data.message || 'Auth exchange failed'),
      { status: res.status }
    );
  }
  return data; // { id, name, email, url, avatar, platform }
}
