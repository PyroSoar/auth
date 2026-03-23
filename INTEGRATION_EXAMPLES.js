/**
 * Unified OAuth Authentication Service — Integration Examples
 *
 * Live service: https://oauth.lzc2002.top/
 *
 * These examples show how to integrate the service with common frameworks.
 * Replace https://oauth.lzc2002.top with your own deployed instance if needed.
 *
 * Supported providers:
 *   github, google, qq, facebook, weibo, twitter, huawei, steam, oidc
 */

const AUTH_SERVICE = 'https://oauth.lzc2002.top';

// ==============================================================================
// Example 1: Express.js — Full Server-Side Integration
// ==============================================================================

const express = require('express');
const session = require('express-session');
const crypto  = require('crypto');

const app1 = express();

app1.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

const VALID_PROVIDERS = ['github', 'google', 'qq', 'facebook', 'weibo', 'twitter', 'huawei', 'steam', 'oidc'];

/**
 * Step 1 — Initiate login
 * Visit: GET /auth/login/github   (or any other provider)
 */
app1.get('/auth/login/:provider', (req, res) => {
  const { provider } = req.params;

  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `Unknown provider "${provider}"` });
  }

  // Generate a random CSRF state token and store it in session
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState    = state;
  req.session.oauthProvider = provider;

  // The service will redirect the browser here after the provider callback
  const callbackUrl = `${process.env.SERVER_URL}/auth/callback/${provider}`;

  // Send the browser to the auth service, which redirects to the OAuth provider
  const authUrl = new URL(`${AUTH_SERVICE}/${provider}`);
  authUrl.searchParams.set('redirect', callbackUrl);
  authUrl.searchParams.set('state', state);

  res.redirect(authUrl.toString());
});

/**
 * Step 2 — Browser callback
 * The OAuth provider redirects back to the auth service, which then forwards
 * the browser here with ?code=<code>&state=<state>&type=<provider>
 *
 * GET /auth/callback/github?code=<code>&state=<state>&type=github
 */
app1.get('/auth/callback/:provider', async (req, res) => {
  const { provider }          = req.params;
  const { code, state, type } = req.query;

  // CSRF check
  if (!state || state !== req.session.oauthState) {
    return res.status(403).json({ error: 'CSRF state mismatch' });
  }
  // Optional: also check that type matches expected provider
  if (type && type !== provider) {
    return res.status(400).json({ error: 'Provider mismatch in callback' });
  }

  try {
    // Step 3 — Exchange the code for user info (server-to-server call)
    const infoUrl = new URL(`${AUTH_SERVICE}/${provider}`);
    infoUrl.searchParams.set('code', code);
    infoUrl.searchParams.set('state', state);

    const response = await fetch(infoUrl.toString(), {
      headers: {
        // Identifying your app as a server-side client triggers the JSON path
        'User-Agent': '@waline',
        'Accept': 'application/json'
      }
    });

    const userData = await response.json();

    if (!response.ok || userData.errno) {
      return res.status(userData.errno || 500).json({
        error: 'Auth service error',
        detail: userData.message || 'Unknown error'
      });
    }

    // userData shape:
    // { id, name, email, url, avatar, platform }

    // Upsert user in your own database
    // const user = await db.users.upsert({ platform_id: userData.id, platform: provider }, userData);

    // Store in session
    req.session.user = {
      id:       userData.id,
      name:     userData.name,
      email:    userData.email,
      avatar:   userData.avatar,
      platform: userData.platform
    };
    delete req.session.oauthState;
    delete req.session.oauthProvider;

    res.redirect('/dashboard');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).json({ error: 'Authentication failed', message: err.message });
  }
});

/** Get current session user */
app1.get('/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.session.user);
});

/** Logout */
app1.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// app1.listen(3000);


// ==============================================================================
// Example 2: Next.js — API Routes
// ==============================================================================

// pages/api/auth/[provider].js  (or app/api/auth/[provider]/route.js)

// import { cookies } from 'next/headers';  // App Router

export async function GET_NextLogin(req, { params }) {
  const { provider } = params;
  const validProviders = ['github', 'google', 'qq', 'facebook', 'weibo', 'twitter', 'huawei', 'steam', 'oidc'];
  if (!validProviders.includes(provider)) {
    return Response.json({ error: 'Invalid provider' }, { status: 400 });
  }

  const state       = crypto.randomUUID();
  const callbackUrl = `${process.env.NEXT_PUBLIC_URL}/api/auth/callback/${provider}`;
  const authUrl     = `${AUTH_SERVICE}/${provider}?redirect=${encodeURIComponent(callbackUrl)}&state=${state}`;

  // Store state in a short-lived cookie
  const response = Response.redirect(authUrl, 302);
  response.headers.set('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  return response;
}

// pages/api/auth/callback/[provider].js
export async function GET_NextCallback(req, { params }) {
  const { provider }             = params;
  const { searchParams }         = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');

  // Verify CSRF state from cookie
  const cookieState = req.cookies.get('oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return Response.json({ error: 'State mismatch' }, { status: 403 });
  }

  const infoUrl = new URL(`${AUTH_SERVICE}/${provider}`);
  infoUrl.searchParams.set('code', code);
  infoUrl.searchParams.set('state', state);

  const resp     = await fetch(infoUrl.toString(), { headers: { 'User-Agent': '@waline' } });
  const userData = await resp.json();

  if (!resp.ok) {
    return Response.json({ error: userData.message }, { status: resp.status });
  }

  // Set session cookie (use iron-session, next-auth, or your own JWT here)
  const sessionResponse = Response.redirect(`${process.env.NEXT_PUBLIC_URL}/dashboard`, 302);
  sessionResponse.headers.append('Set-Cookie', `oauth_state=; Path=/; Max-Age=0`);
  // sessionResponse.headers.append('Set-Cookie', buildSessionCookie(userData));
  return sessionResponse;
}


// ==============================================================================
// Example 3: Vanilla Browser JavaScript — Popup Flow
// ==============================================================================

/**
 * Opens a popup window for OAuth login.
 * The popup redirects through the auth service, then back to /oauth-callback.html.
 */
class OAuthPopup {
  constructor(authServiceUrl = AUTH_SERVICE) {
    this.authServiceUrl = authServiceUrl;
    this._listeners     = {};
  }

  /**
   * @param {'github'|'google'|'qq'|'facebook'|'weibo'|'twitter'|'huawei'|'steam'|'oidc'} provider
   * @returns {Promise<{id, name, email, url, avatar, platform}>}
   */
  login(provider) {
    return new Promise((resolve, reject) => {
      const state       = Math.random().toString(36).slice(2);
      const callbackUrl = `${location.origin}/oauth-callback.html`;

      const authUrl = `${this.authServiceUrl}/${provider}`
        + `?redirect=${encodeURIComponent(callbackUrl)}`
        + `&state=${encodeURIComponent(state)}`;

      const popup = window.open(authUrl, 'oauth_popup', 'width=520,height=640,menubar=no,toolbar=no');
      if (!popup) { reject(new Error('Popup blocked')); return; }

      const onMessage = async (event) => {
        if (event.origin !== location.origin) return;
        if (!event.data || event.data.type !== 'oauth_callback') return;

        window.removeEventListener('message', onMessage);

        const { code, state: returnedState } = event.data;
        if (returnedState !== state) { reject(new Error('CSRF state mismatch')); return; }

        // Exchange code for user info via your own backend to keep secrets server-side
        try {
          const res  = await fetch(`/api/auth/exchange?provider=${provider}&code=${code}&state=${returnedState}`);
          const user = await res.json();
          res.ok ? resolve(user) : reject(new Error(user.message || 'Exchange failed'));
        } catch (err) {
          reject(err);
        }
      };

      window.addEventListener('message', onMessage);

      // Clean up if popup is closed without completing login
      const pollClose = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollClose);
          window.removeEventListener('message', onMessage);
          reject(new Error('Login popup closed'));
        }
      }, 500);
    });
  }
}

// oauth-callback.html — place at your origin
// <script>
//   const params = new URLSearchParams(location.search);
//   window.opener.postMessage({
//     type: 'oauth_callback',
//     code:  params.get('code'),
//     state: params.get('state'),
//     platformType: params.get('type')
//   }, location.origin);
//   window.close();
// </script>

// Usage:
// const oauth = new OAuthPopup();
// const user  = await oauth.login('github');
// console.log(user.name, user.avatar);


// ==============================================================================
// Example 4: Check which providers are enabled on the auth service
// ==============================================================================

/**
 * Returns the list of active providers from the live service.
 * Useful for showing only available login buttons in your UI.
 */
async function getAvailableProviders() {
  const res  = await fetch(AUTH_SERVICE);
  const data = await res.json();
  // data.services = [{ name: 'github', origin: 'github.com' }, ...]
  return data.services.map(s => s.name);
}

// Example:
// const providers = await getAvailableProviders();
// // ['github', 'weibo', 'twitter', 'google', 'qq', 'huawei', 'steam']
// providers.forEach(p => renderLoginButton(p));


// ==============================================================================
// Example 5: Waline Comment System Integration
// ==============================================================================

/**
 * Waline uses User-Agent: @waline for server-phase token exchange.
 * This example shows the server-side handler Waline calls internally.
 *
 * The sequence from Waline's perspective:
 *   1. Waline's frontend redirects browser to <authService>/<provider>?redirect=<walineApi>/oauth
 *   2. After browser callback, Waline's API receives ?code=X&state=Y
 *   3. Waline calls <authService>/<provider>?code=X&state=Y with User-Agent: @waline
 *   4. Auth service returns unified user JSON
 *   5. Waline creates/updates user and issues its own JWT
 */
async function walineOAuthExchange({ provider, code, state, authServiceUrl = AUTH_SERVICE }) {
  const url = new URL(`${authServiceUrl}/${provider}`);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': '@waline',
      'Accept':     'application/json'
    }
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw Object.assign(new Error(err.message), { status: response.status, code: err.errno });
  }

  return response.json();
  // Returns: { id, name, email, url, avatar, platform }
}

// Waline then does something like:
// const oauthUser = await walineOAuthExchange({ provider: 'github', code, state });
// const walineUser = await findOrCreateUser({
//   type:     oauthUser.platform,
//   objectId: oauthUser.id,
//   defaults: { nick: oauthUser.name, avatar: oauthUser.avatar, email: oauthUser.email, link: oauthUser.url }
// });


// ==============================================================================
// Example 6: Twitter / X — PKCE-Aware Flow Notes
// ==============================================================================

/**
 * Twitter uses OAuth 2.0 + PKCE with a stateless base64url-encoded state.
 * The `state` returned in the callback is a JSON payload, NOT the plain string
 * you passed in the `state` param — it wraps your original state plus PKCE data.
 *
 * On the server-phase call, pass the FULL encoded state back:
 */
async function twitterExchange({ code, encodedState }) {
  const url = new URL(`${AUTH_SERVICE}/twitter`);
  url.searchParams.set('code', code);
  url.searchParams.set('state', encodedState);  // The complete base64url state from callback

  const res  = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  const user = await res.json();

  if (!res.ok) throw new Error(user.message || 'Twitter exchange failed');
  return user;
}

/**
 * Note on Twitter email:
 * The `users.email` scope requires Twitter to review and approve your app.
 * Until approved, the email field will be `<id>@twitter-uuid.com` (a placeholder).
 */


// ==============================================================================
// Example 7: Steam — OpenID 2.0 Notes
// ==============================================================================

/**
 * Steam uses OpenID 2.0, not OAuth. The flow differs:
 *
 * 1. Your frontend links to:
 *    https://oauth.lzc2002.top/steam?redirect=<walineCallbackUrl>&state=<state>
 *
 * 2. The auth service constructs an openid.return_to URL that Waline will receive,
 *    then sends the user to steamcommunity.com.
 *
 * 3. Steam redirects to the return_to URL with openid.* query params.
 *    Waline (or your backend) receives these params.
 *
 * 4. Your backend calls the auth service:
 *    GET https://oauth.lzc2002.top/steam?<all openid.* params>
 *    with User-Agent: @waline
 *
 * 5. The service verifies the OpenID assertion with Steam and returns user JSON.
 *
 * Important: Steam does not provide email. The `email` field will be:
 *   "<steamId>@steam-uuid.com"
 */

async function steamExchange(openIdCallbackParams) {
  // openIdCallbackParams is the full query string from Steam's redirect
  const url = new URL(`${AUTH_SERVICE}/steam`);

  for (const [key, value] of Object.entries(openIdCallbackParams)) {
    url.searchParams.set(key, value);
  }

  const res  = await fetch(url.toString(), { headers: { 'User-Agent': '@waline' } });
  const user = await res.json();

  if (!res.ok) throw new Error(user.message || 'Steam exchange failed');
  return user;
}


// ==============================================================================
// Example 8: OIDC — Connecting a Generic Provider (e.g. Authentik, Keycloak)
// ==============================================================================

/**
 * Configure your OIDC provider in environment variables.
 *
 * For Authentik:
 *   OIDC_ID     = <your app client ID>
 *   OIDC_SECRET = <your app client secret>
 *   OIDC_ISSUER = https://authentik.example.com/application/o/<slug>/
 *
 * For Keycloak:
 *   OIDC_ISSUER = https://keycloak.example.com/realms/<realm>
 *
 * For providers without discovery (e.g. custom IdP):
 *   OIDC_AUTH_URL      = https://idp.example.com/authorize
 *   OIDC_TOKEN_URL     = https://idp.example.com/token
 *   OIDC_USERINFO_URL  = https://idp.example.com/userinfo
 *   OIDC_SCOPES        = openid profile email
 *
 * The OIDC provider's redirect_uri must be set to the `redirect` value your
 * application passes — the auth service uses your app's callback URL directly
 * as the redirect_uri, not its own /oidc path.
 *
 * Initiate:
 *   GET https://oauth.lzc2002.top/oidc?redirect=<yourCallback>&state=<state>
 *
 * Exchange:
 *   GET https://oauth.lzc2002.top/oidc?code=<code>&state=<encodedState>
 *   (with User-Agent: @waline)
 */


// ==============================================================================
// Example 9: React Hook — useOAuth
// ==============================================================================

// import { useState, useCallback } from 'react';

function useOAuth(authServiceUrl = AUTH_SERVICE) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const login = useCallback((provider) => {
    setLoading(true);
    setError(null);

    const state       = Math.random().toString(36).slice(2);
    const callbackUrl = `${location.origin}/oauth-callback`;

    // Save state for verification when the popup posts back
    sessionStorage.setItem('oauth_state', state);

    const authUrl = `${authServiceUrl}/${provider}`
      + `?redirect=${encodeURIComponent(callbackUrl)}`
      + `&state=${encodeURIComponent(state)}`;

    const popup = window.open(authUrl, 'oauth', 'width=520,height=640');

    const onMessage = async (event) => {
      if (event.origin !== location.origin) return;
      if (event.data?.type !== 'oauth_callback') return;
      window.removeEventListener('message', onMessage);

      const savedState = sessionStorage.getItem('oauth_state');
      if (event.data.state !== savedState) {
        setError('CSRF state mismatch');
        setLoading(false);
        return;
      }
      sessionStorage.removeItem('oauth_state');

      try {
        // Your backend endpoint that calls the auth service server-side
        const res  = await fetch('/api/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, code: event.data.code, state: event.data.state })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Exchange failed');
        setUser(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    window.addEventListener('message', onMessage);
  }, [authServiceUrl]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  return { user, loading, error, login, logout };
}

// Usage in a component:
// function LoginButton({ provider }) {
//   const { login, loading, error } = useOAuth();
//   return (
//     <button onClick={() => login(provider)} disabled={loading}>
//       {loading ? 'Connecting…' : `Login with ${provider}`}
//     </button>
//   );
// }
