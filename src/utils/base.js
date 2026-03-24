const { createUserResponse,createErrorResponse } = require('./utils');
const qs = require('querystring');
const storage = require('./utils/storage/db');

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

    // Construct response
    const response = createUserResponse(userInfo, platform);
    const result = response.get ? response.get() : response;

    // THIS LOG MUST APPEAR
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
    const qs = require('querystring');
    const code = this.ctx.params?.code || this.ctx.query?.code;
    // Step 1: If no code, this is the initial OAuth entry → redirect to provider
    if (!code) {
      console.log('[Base.getUserInfo] No code found, redirecting to authorize()...');
      return this.redirect();
    }

    // Step 2: Extract redirect and inner state from the encoded state string
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

        if (parsed.type) {
          // Preserve platform type (weibo/google/etc.)
          console.log('[Base.getUserInfo] Extracted type from state:', parsed.type);
          // We will append this later to the final redirect URL
        }

      } catch (err) {
        console.error('[Base.getUserInfo] Failed to parse state:', state, err.message);
      }
    }

    // Step 3: Normalize redirect into a full URL
    let finalRedirect = redirect;
    if (redirect) {
      if (redirect.startsWith('http')) {
        finalRedirect = redirect;
        console.log('[Base.getUserInfo] Redirect is full URL:', finalRedirect);
      } else if (redirect.startsWith('/')) {
        finalRedirect = this.getCompleteUrl(redirect);
        console.log('[Base.getUserInfo] Redirect is relative path, completed to:', finalRedirect);
      } else {
        finalRedirect = this.getCompleteUrl('/' + redirect);
        console.log('[Base.getUserInfo] Redirect is plain string, completed to:', finalRedirect);
      }
    } else {
      console.log('[Base.getUserInfo] No redirect provided.');
    }

    // Step 4: One-phase flow — always exchange code for user info here,
    // then either redirect the browser with the result or return JSON directly.
    this.ctx.type = 'json';
    let userInfo;
    try {
      console.log('[Base.getUserInfo] Fetching access token...');
      const accessTokenInfo = await this.getAccessToken(code);
      console.log('[Base.getUserInfo] Access token info:', accessTokenInfo);

      console.log('[Base.getUserInfo] Fetching user info...');
      userInfo = await this.getUserInfoByToken(accessTokenInfo);
      console.log('[Base.getUserInfo] User info:', userInfo);
    } catch (error) {
      console.error('[Base.getUserInfo] Error exchanging code:', error.message);
      if (finalRedirect) {
        // Redirect client with error info so they can handle it gracefully
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

    // If a redirect URL was provided, send the browser there with user data as query params
    if (finalRedirect) {
      try {
        const url = new URL(finalRedirect);
        // Embed the full user object as individual query params
        for (const [key, value] of Object.entries(userInfo)) {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
          }
        }
        if (state) url.searchParams.set('state', state);
        console.log('[Base.getUserInfo] One-phase: Redirecting client with user info:', url.toString());
        return this.ctx.redirect(url.toString());
      } catch (err) {
        console.error('[Base.getUserInfo] Invalid redirect URL:', finalRedirect, err.message);
      }
    }

    // No redirect — return JSON directly (server-to-server call)
    return this.ctx.body = userInfo;
  }


};