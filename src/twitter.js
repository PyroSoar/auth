const Base = require('./base');
const crypto = require('crypto');
const qs = require('querystring');
const request = require('request-promise-native');

const AUTH_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const USER_INFO_URL = 'https://api.x.com/2/users/me';

const TWITTER_CLIENT_ID = process.env.TWITTER_ID;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_SECRET;

/**
 * Convert a buffer to base64url format (RFC 7636)
 */
function base64url(buf) {
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Generate PKCE verifier and challenge pair
 */
function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash('sha256').update(verifier).digest()
  );
  return { verifier, challenge };
}

/**
 * Encode state payload into base64url for stateless OAuth
 */
function encodeStateData(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Decode base64url-encoded state payload
 */
function decodeStateData(encoded) {
  try {
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const decoded = Buffer.from(
      padded.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString();
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

module.exports = class extends Base {
  static check() {
    return TWITTER_CLIENT_ID && TWITTER_CLIENT_SECRET;
  }

  static info() {
    return {
      origin: new URL(AUTH_URL).hostname
    };
  }

  /**
   * Step 1 — Redirect user to Twitter OAuth (Authorization Endpoint)
   * Includes PKCE challenge + encoded state (redirect URL, PKCE verifier, etc.)
   */
  async redirect() {
    const { redirect: clientRedirect, state: clientState } = this.ctx.params;
    const callbackUrl = this.getCompleteUrl('/twitter');

    const { verifier: pkceVerifier, challenge: pkceChallenge } = generatePKCE();

    // State payload sent to Twitter (encoded)
    const encodedState = encodeStateData({
      verifier: pkceVerifier,
      redirect: clientRedirect,
      state: clientState,
      callbackUrl
    });

    const params = {
      response_type: 'code',
      client_id: TWITTER_CLIENT_ID,
      redirect_uri: callbackUrl,
      scope: [
        'tweet.read',
        'users.read',
        'offline.access',
        'users.email'
      ].join(' '),
      state: encodedState,
      code_challenge: pkceChallenge,
      code_challenge_method: 'S256'
    };

    return this.ctx.redirect(AUTH_URL + '?' + qs.stringify(params));
  }

  /**
   * Step 2 — Exchange authorization code for access token (Token Endpoint)
   */
  async getAccessToken({ code, stateData }) {
    const { verifier: pkceVerifier, callbackUrl } = stateData;
    const credentials = Buffer.from(
      `${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`
    ).toString('base64');

    return await request({
      url: TOKEN_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      form: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        code_verifier: pkceVerifier
      },
      json: true
    });
  }

  /**
   * Step 3 — Fetch user profile using access token
   */
  async getUserInfoByToken(accessToken) {
    const url = USER_INFO_URL +
      '?user.fields=name,username,profile_image_url,url,confirmed_email';

    return await request({
      url,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      json: true
    });
  }

  /**
   * Step 4 — Handle OAuth callback (Browser Phase + Server Phase)
   */
  async getUserInfo() {
    const { code: authCode, state: encodedState } = this.ctx.params;

    // Determine whether client expects JSON (Waline server) or browser redirect
    const expectsJSON = (
      (this.ctx.headers.accept || '').includes('application/json') ||
      this.ctx.headers['user-agent'] === '@waline'
    );

    // Missing required OAuth parameters
    if (!authCode || !encodedState) {
      if (expectsJSON) {
        this.ctx.status = 400;
        this.ctx.body = {
          error: 'missing_code_or_state',
          message: 'OAuth callback requires both code and state parameters.'
        };
        return;
      }
      return this.redirect();
    }

    this.ctx.type = 'json';

    // Decode state payload (PKCE verifier + redirect URL)
    const stateData = decodeStateData(encodedState);
    if (!stateData) {
      this.ctx.status = 400;
      this.ctx.body = {
        error: 'invalid_state',
        message: 'OAuth state is invalid or could not be decoded.'
      };
      return;
    }

    const { redirect: clientRedirect } = stateData;
    const isBrowserRequest = !expectsJSON;

    /**
     * Browser Phase:
     * Redirect back to client with ?code=...&state=...
     */
    if (isBrowserRequest && clientRedirect) {
      return this.ctx.redirect(
        clientRedirect +
        (clientRedirect.includes('?') ? '&' : '?') +
        qs.stringify({ code: authCode, state: encodedState })
      );
    }

    /**
     * Server Phase:
     * Exchange code → access_token → user info
     */
    let tokenInfo;
    try {
      tokenInfo = await this.getAccessToken({ code: authCode, stateData });
    } catch (err) {
      this.ctx.status = 500;
      this.ctx.body = {
        error: 'token_exchange_failed',
        message: err.message || 'Failed to obtain access token from Twitter.',
        details: err.error || null
      };
      return;
    }

    if (!tokenInfo || !tokenInfo.access_token) {
      this.ctx.status = 401;
      this.ctx.body = {
        error: 'no_access_token',
        message: 'Twitter did not return an access token.',
        raw: tokenInfo
      };
      return;
    }

    // Fetch user profile
    let userInfo;
    try {
      userInfo = await this.getUserInfoByToken(tokenInfo.access_token);
    } catch (err) {
      this.ctx.status = 500;
      this.ctx.body = {
        error: 'user_info_fetch_failed',
        message: err.message || 'Failed to fetch user info from Twitter.',
        details: err.error || null
      };
      return;
    }

    const u = userInfo && userInfo.data ? userInfo.data : {};

    // Final structured user response
    this.ctx.status = 200;
    this.ctx.body = await this.formatUserResponse({
      id: u.id,
      name: u.name || u.username,
      email: u.email || u.confirmed_email || `${u.id}@twitter-uuid.com`,
      url: u.url || (u.username ? `https://x.com/${u.username}` : undefined),
      avatar: u.profile_image_url || undefined,
      originalResponse: u
    }, 'twitter');
  }
};
