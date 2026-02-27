const Base = require('./base');
const qs = require('querystring');

const OAUTH_URL = 'https://api.weibo.com/oauth2/authorize';
const ACCESS_TOKEN_URL = 'https://api.weibo.com/oauth2/access_token';
const TOKEN_INFO_URL = 'https://api.weibo.com/oauth2/get_token_info';
const USER_INFO_URL = 'https://api.weibo.com/2/users/show.json';

const { WEIBO_ID, WEIBO_SECRET } = process.env;

module.exports = class extends Base {

  static check() {
    return WEIBO_ID && WEIBO_SECRET;
  }

  static info() {
    return {
      origin: new URL(OAUTH_URL).hostname
    };
  }

  async auth() {
    const { code } = this.ctx.query;

    if (!code) {
      return this.redirect();
    }

    console.log('[weibo] callback received, code:', code);

    try {
      const token = await this.getAccessToken(code);
      return await this.getUserInfoByToken(token);
    } catch (err) {
      console.error('[weibo] OAuth error:', err);
      this.ctx.status = 500;
      this.ctx.body = { error: err.message };
    }
  }

  redirect() {
    const { state } = this.ctx.params;
    const redirectUri = this.getCompleteUrl('/weibo');

    const url = OAUTH_URL + '?' + qs.stringify({
      client_id: WEIBO_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      state
    });

    console.log('[weibo] redirecting to:', url);

    return this.ctx.redirect(url);
  }

  async getAccessToken(code) {
    const redirectUri = this.getCompleteUrl('/weibo');

    const response = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: qs.stringify({
        client_id: WEIBO_ID,
        client_secret: WEIBO_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    console.log('[weibo] access_token response:', data);

    return data;
  }

  async getUserInfoByToken({ access_token }) {

    // Step 1: get token info
    const tokenRes = await fetch(TOKEN_INFO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: qs.stringify({ access_token })
    });

    const tokenInfo = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new Error(JSON.stringify(tokenInfo));
    }

    // Step 2: get user info
    const userRes = await fetch(
      USER_INFO_URL + '?' + qs.stringify({
        access_token,
        uid: tokenInfo.uid
      })
    );

    const userInfo = await userRes.json();

    if (!userRes.ok) {
      throw new Error(JSON.stringify(userInfo));
    }

    console.log('[weibo] user info fetched:', userInfo.idstr);

    return await this.formatUserResponse({
      id: userInfo.idstr,
      name: userInfo.screen_name || userInfo.name,
      email: undefined,
      url: userInfo.url || `https://weibo.com/u/${userInfo.id}`,
      avatar: userInfo.avatar_large || userInfo.profile_image_url
    }, 'weibo');
  }
};