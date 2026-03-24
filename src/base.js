const { createUserResponse, createErrorResponse } = require('./utils');
const qs = require('querystring');
const storage = require('./utils/storage/db');

/**
 * Escape a string for safe use inside HTML attribute values.
 */
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build a self-submitting HTML form that POSTs `fields` to `action`.
 * Used to deliver user data to the client callback without putting it in the URL.
 * Exported so provider modules can import it instead of redeclaring locally.
 */
function buildPostForm(action, fields) {
  const inputs = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      let value = v;
      if (typeof v === 'object') {
        value = JSON.stringify(v);
      }
      return `<input type="hidden" name="${escHtml(k)}" value="${escHtml(String(value))}">`;
    })
    .join('\n    ');

  const userName = fields.name || '';

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Redirecting…</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            min-height: 100vh;
            min-height: 100dvh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 16px;
        }
        .container {
            text-align: center;
            padding: 32px 24px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 360px;
        }
        .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        h1 {
            font-size: 20px;
            color: #333;
            margin-bottom: 12px;
            line-height: 1.4;
            word-break: break-word;
        }
        .name {
            color: #667eea;
            font-weight: 600;
        }
        p {
            color: #666;
            font-size: 14px;
            line-height: 1.5;
        }
        .redirect-hint {
            margin-top: 16px;
            font-size: 12px;
            color: #999;
        }
        @media (max-width: 480px) {
            .container {
                padding: 28px 20px;
                border-radius: 12px;
            }
            h1 {
                font-size: 18px;
            }
            p {
                font-size: 13px;
            }
            .spinner {
                width: 40px;
                height: 40px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h1>Welcome <span class="name">${escHtml(userName)}</span></h1>
        <p>Login successful! Redirecting you back to the application...</p>
        <p class="redirect-hint">Please wait a moment...</p>
    </div>
    <form id="f" method="POST" action="${escHtml(action)}">
        ${inputs}
    </form>
    <script>document.getElementById('f').submit();</script>
</body>
</html>`;
}

/**
 * Fetch an image URL and return it as a base64 data URI.
 * Sends a spoofed Referer so providers that use hotlink protection
 * (e.g. Weibo) serve the image to server-side requests.
 *
 * @param {string} url        - Image URL to fetch
 * @param {string} [referer]  - Referer header value (defaults to the image origin)
 * @returns {Promise<string|null>} base64 data URI, or null on failure
 */
async function fetchAvatarAsBase64(url, referer) {
  if (!url) return null;
  try {
    const ref = referer || new URL(url).origin;
    const res = await fetch(url, {
      headers: {
        'Referer': ref,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('[base] fetchAvatarAsBase64 failed:', err.message);
    return null;
  }
}

module.exports = class {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async formatUserResponse(userInfo, platform = '') {
    console.log('[base] formatUserResponse called:', platform);

    if (process.env.POSTGRES_URL) {
      try {
        const { waitUntil } = require('@vercel/functions');
        waitUntil(
          storage.upsertThirdPartyInfo(platform, userInfo)
            .then(ok => console.log('[base] DB update result:', ok))
            .catch(err => console.error('[base] DB background error:', err.message))
        );
      } catch (e) {
        // vercel/functions package might not be installed in all envs
      }
    }

    const response = createUserResponse(userInfo, platform);
    const result = response.get ? response.get() : response;
    console.log('[base] Returning response data:', JSON.stringify(result));
    return result;
  }

  getCompleteUrl(url = '') {
    const { SERVER_URL } = process.env;
    const protocol = this.ctx?.header?.['x-forwarded-proto'] || 'http';
    const host = this.ctx?.header?.['x-forwarded-host'] || this.ctx?.host || '';
    const baseUrl = SERVER_URL || `${protocol}://${host}`;
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    return baseUrl + cleanUrl;
  }

  async getUserInfo() {
    const code = this.ctx.params?.code || this.ctx.query?.code;
    const error = this.ctx.params?.error || this.ctx.query?.error;
    const errorDescription = this.ctx.params?.error_description || this.ctx.query?.error_description;

    if (error) {
      const errorMessage = errorDescription ? `${error}: ${errorDescription}` : error;
      console.error('[Base.getUserInfo] OAuth error received:', errorMessage);
      
      let redirect = this.ctx.query?.redirect || this.ctx.params?.redirect;
      let state = this.ctx.query?.state || this.ctx.params?.state;
      
      if (redirect) {
        try {
          let finalRedirect = redirect;
          if (redirect.startsWith('http')) {
            finalRedirect = redirect;
          } else if (redirect.startsWith('/')) {
            finalRedirect = this.getCompleteUrl(redirect);
          } else {
            finalRedirect = this.getCompleteUrl('/' + redirect);
          }
          
          const errUrl = new URL(finalRedirect);
          errUrl.searchParams.set('error', errorMessage);
          if (state) errUrl.searchParams.set('state', state);
          return this.ctx.redirect(errUrl.toString());
        } catch (err) {
          console.error('[Base.getUserInfo] Failed to build error redirect URL:', err.message);
        }
      }
      
      this.ctx.status = 400;
      this.ctx.body = { error: errorMessage };
      return;
    }

    if (!code) {
      console.log('[Base.getUserInfo] No code found, redirecting to authorize()...');
      return this.redirect();
    }

    // Step 2: Extract redirect and inner state from params or encoded state
    let redirect = this.ctx.query?.redirect || this.ctx.params?.redirect;
    let state = this.ctx.query?.state || this.ctx.params?.state;
    if (!redirect && state) {
      try {
        const parsed = qs.parse(state);
        if (parsed.redirect) {
          redirect = parsed.redirect;
          console.log('[Base.getUserInfo] Extracted redirect from state:', redirect);
        }
        if (parsed.state) {
          state = parsed.state;
          console.log('[Base.getUserInfo] Extracted inner state:', state);
        }
      } catch (err) {
        console.error('[Base.getUserInfo] Failed to parse state:', state, err.message);
      }
    }

    // Step 3: Normalize redirect to a full URL
    let finalRedirect = redirect;
    if (redirect) {
      if (redirect.startsWith('http')) {
        finalRedirect = redirect;
      } else if (redirect.startsWith('/')) {
        finalRedirect = this.getCompleteUrl(redirect);
      } else {
        finalRedirect = this.getCompleteUrl('/' + redirect);
      }
      console.log('[Base.getUserInfo] Final redirect:', finalRedirect);
    }

    // Step 4: One-phase — exchange code, fetch user info
    this.ctx.type = 'json';
    let userInfo;
    try {
      console.log('[Base.getUserInfo] Fetching access token...');
      const accessTokenInfo = await this.getAccessToken(code);
      console.log('[Base.getUserInfo] Fetching user info...');
      userInfo = await this.getUserInfoByToken(accessTokenInfo);
    } catch (error) {
      console.error('[Base.getUserInfo] Error exchanging code:', error.message);
      if (finalRedirect) {
        try {
          const errUrl = new URL(finalRedirect);
          errUrl.searchParams.set('error', error.message);
          if (state) errUrl.searchParams.set('state', state);
          return this.ctx.redirect(errUrl.toString());
        } catch (_) {}
      }
      this.ctx.status = 500;
      this.ctx.body = { error: error.message };
      return;
    }

    // Step 5: Deliver result — POST form to client callback, or JSON for server calls
    if (finalRedirect) {
      const payload = { ...userInfo };
      if (state) payload.state = state;
      console.log('[Base.getUserInfo] One-phase: POSTing user info to:', finalRedirect);
      this.ctx.type = 'html';
      this.ctx.body = buildPostForm(finalRedirect, payload);
      return;
    }

    // No redirect — server-to-server call, return JSON directly
    return this.ctx.body = userInfo;
  }
};

// Attach shared helpers so provider modules can import from a single place:
//   const Base = require('./base');
//   const { buildPostForm, fetchAvatarAsBase64 } = Base;
module.exports.buildPostForm      = buildPostForm;
module.exports.fetchAvatarAsBase64 = fetchAvatarAsBase64;