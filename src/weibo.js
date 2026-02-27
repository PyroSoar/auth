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

  /**
   * Step 1: redirect to Weibo authorize page
   */
  redirect() {
    const { redirect, state } = this.ctx.params;

    // IMPORTANT: redirect_uri MUST be pure
    const redirectUri = this.getCompleteUrl('/weibo');

    console.log('[weibo] redirect_uri used:', redirectUri);

    const url = OAUTH_URL + '?' + qs.stringify({
      client_id: WEIBO_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: qs.stringify({ redirect, state }) // put custom data into state
    });

    return this.ctx.redirect(url);
  }

  /**
   * Step 2: exchange code for access token
   */
  async getAccessToken(code) {

    const redirectUri = this.getCompleteUrl('/weibo');

    console.log('[weibo] access_token redirect_uri:', redirectUri);

    const params = {
      client_id: WEIBO_ID,
      client_secret: WEIBO_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    };

    return request.post({
      url: ACCESS_TOKEN_URL,
      form: params,
      json: true
    });
  }

  /**
   * Step 3: get user info
   */
  async getUserInfoByToken({ access_token }) {

    const tokenInfo = await request.post({
      url: TOKEN_INFO_URL,
      form: { access_token },
      json: true
    });
    console.log('[weibo] access_token:', access_token);
    console.log('[weibo] tokenInfo:', tokenInfo);
    const userInfo = await request.get(
      USER_INFO_URL + '?' + qs.stringify({
        access_token,
        uid: tokenInfo.uid
      }),
      { json: true }
    );

    console.log('[weibo] userInfo id:', userInfo.idstr);

    return await this.formatUserResponse({
      id: userInfo.idstr,
      name: userInfo.screen_name || userInfo.name,
      email: undefined,
      url: userInfo.url || `https://weibo.com/u/${userInfo.id}`,
      avatar: userInfo.avatar_large || userInfo.profile_image_url
    }, 'weibo');
  }
};