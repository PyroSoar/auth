const Base = require('./base');
const qs = require('querystring');
const request = require('request-promise-native');

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

    // Step 1: first visit → redirect to Weibo
    if (!code) {
      return this.redirect();
    }

    console.log('[weibo] callback received, code:', code);

    try {
      // Step 2: exchange code for access_token
      const token = await this.getAccessToken(code);

      console.log('[weibo] token received');

      // Step 3: fetch user info & return Waline response
      return await this.getUserInfoByToken(token);

    } catch (err) {
      console.error('[weibo] OAuth error:', err.message);
      throw err;
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

    return request.post({
      url: ACCESS_TOKEN_URL,
      form: {
        client_id: WEIBO_ID,
        client_secret: WEIBO_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      },
      json: true
    });
  }

  async getUserInfoByToken({ access_token }) {

    const tokenInfo = await request.post({
      url: TOKEN_INFO_URL,
      form: { access_token },
      json: true
    });

    const userInfo = await request.get(
      USER_INFO_URL + '?' + qs.stringify({
        access_token,
        uid: tokenInfo.uid
      }),
      { json: true }
    );

    return await this.formatUserResponse({
      id: userInfo.idstr,
      name: userInfo.screen_name || userInfo.name,
      email: undefined,
      url: userInfo.url || `https://weibo.com/u/${userInfo.id}`,
      avatar: userInfo.avatar_large || userInfo.profile_image_url
    }, 'weibo');
  }
};