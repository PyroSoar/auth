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

  redirect() {
    const { state } = this.ctx.params;
    const redirectUri = this.getCompleteUrl('/weibo');

    const url = OAUTH_URL + '?' + qs.stringify({
      client_id: WEIBO_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      state // ⭐ 直接透传
    });

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

  /**
   * 下载头像并转 base64
   */
  async fetchAvatarAsBase64(avatarUrl) {
    try {
      console.log('[weibo] downloading avatar:', avatarUrl);

      const buffer = await request.get({
        url: avatarUrl,
        encoding: null, // IMPORTANT: return buffer
        headers: {
          Referer: 'https://weibo.com/',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 8000
      });

      const contentType = 'image/jpeg'; // Weibo usually jpg
      const base64 = buffer.toString('base64');

      console.log('[weibo] avatar size:', buffer.length);

      return `data:${contentType};base64,${base64}`;

    } catch (err) {
      console.error('[weibo] avatar download failed:', err.message);
      return avatarUrl; // fallback to original url
    }
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

    let avatarUrl = userInfo.avatar_large || userInfo.profile_image_url;

    // 🔥 convert avatar to base64
    const avatarBase64 = await this.fetchAvatarAsBase64(avatarUrl);

    return await this.formatUserResponse({
      id: userInfo.idstr,
      name: userInfo.screen_name || userInfo.name,
      email: undefined,
      url: userInfo.url || `https://weibo.com/u/${userInfo.id}`,
      avatar: avatarBase64
    }, 'weibo');
  }
};