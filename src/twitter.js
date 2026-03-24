const Base = require('./base');
const { buildPostForm } = Base;
const crypto = require('crypto');
const qs = require('querystring');
const request = require('request-promise-native');

const AUTH_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const USER_INFO_URL = 'https://api.x.com/2/users/me';

const TWITTER_CLIENT_ID = process.env.TWITTER_ID;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_SECRET;

function base64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function encodeStateData(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeStateData(encoded) {
  try {
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

module.exports = class extends Base {
  static check() { return TWITTER_CLIENT_ID && TWITTER_CLIENT_SECRET; }
  static info() { return { origin: new URL(AUTH_URL).hostname }; }

  /** Step 1 — Redirect to X authorization page with PKCE */
  async redirect() {
    const { redirect: clientRedirect, state: clientState } = this.ctx.params;
    const callbackUrl = this.getCompleteUrl('/twitter');
    const { verifier: pkceVerifier, challenge: pkceChallenge } = generatePKCE();

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
      scope: ['tweet.read', 'users.read', 'offline.access', 'users.email'].join(' '),
      state: encodedState,
      code_challenge: pkceChallenge,
      code_challenge_method: 'S256'
    };

    return this.ctx.redirect(AUTH_URL + '?' + qs.stringify(params));
  }

  /** Step 2 — Exchange code for access token using PKCE verifier */
  async getAccessToken({ code, stateData }) {
    const { verifier: pkceVerifier, callbackUrl } = stateData;
    const credentials = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

    return await request({
      url: TOKEN_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      form: { grant_type: 'authorization_code', code, redirect_uri: callbackUrl, code_verifier: pkceVerifier },
      json: true
    });
  }

  /** Step 3 — Fetch user profile */
  async getUserInfoByToken(accessToken) {
    return await request({
      url: USER_INFO_URL + '?user.fields=name,username,profile_image_url,url,confirmed_email',
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      json: true
    });
  }

  /** Step 4 — Full one-phase flow */
  async getUserInfo() {
    const { code: authCode, state: encodedState } = this.ctx.params;

    if (!authCode || !encodedState) return this.redirect();

    this.ctx.type = 'json';

    const stateData = decodeStateData(encodedState);
    if (!stateData) {
      this.ctx.status = 400;
      this.ctx.body = { error: 'invalid_state', message: 'OAuth state is invalid or could not be decoded.' };
      return;
    }

    const { redirect: clientRedirect } = stateData;

    // Helper: redirect with error as URL param (short, safe)
    const redirectError = (msg) => {
      if (clientRedirect) {
        const errUrl = new URL(clientRedirect);
        errUrl.searchParams.set('error', msg);
        if (stateData.state) errUrl.searchParams.set('state', stateData.state);
        return this.ctx.redirect(errUrl.toString());
      }
    };

    let tokenInfo;
    try {
      tokenInfo = await this.getAccessToken({ code: authCode, stateData });
    } catch (err) {
      const errMsg = err.message || 'Failed to obtain access token from Twitter.';
      if (redirectError(errMsg)) return;
      this.ctx.status = 500;
      this.ctx.body = { error: 'token_exchange_failed', message: errMsg, details: err.error || null };
      return;
    }

    if (!tokenInfo || !tokenInfo.access_token) {
      const errMsg = 'Twitter did not return an access token.';
      if (redirectError(errMsg)) return;
      this.ctx.status = 401;
      this.ctx.body = { error: 'no_access_token', message: errMsg, raw: tokenInfo };
      return;
    }

    let rawUserInfo;
    try {
      rawUserInfo = await this.getUserInfoByToken(tokenInfo.access_token);
    } catch (err) {
      const errMsg = err.message || 'Failed to fetch user info from Twitter.';
      if (redirectError(errMsg)) return;
      this.ctx.status = 500;
      this.ctx.body = { error: 'user_info_fetch_failed', message: errMsg, details: err.error || null };
      return;
    }

    const u = rawUserInfo && rawUserInfo.data ? rawUserInfo.data : {};

    const userInfo = await this.formatUserResponse({
      id: u.id,
      name: u.name || u.username,
      email: u.email || u.confirmed_email || `${u.id}@twitter-uuid.com`,
      url: u.url || (u.username ? `https://x.com/${u.username}` : undefined),
      avatar: u.profile_image_url || undefined,
      originalResponse: u
    }, 'twitter');

    // One-phase: POST user data to client callback
    if (clientRedirect) {
      const payload = { ...userInfo };
      if (stateData.state) payload.state = stateData.state;
      this.ctx.type = 'html';
      this.ctx.body = buildPostForm(clientRedirect, payload);
      return;
    }

    // Server-to-server: return JSON directly
    this.ctx.status = 200;
    this.ctx.body = userInfo;
  }
};
