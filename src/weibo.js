const Base = require('./base');
const qs = require('querystring');

const WEIBO_AUTHORIZE_URL = 'https://api.weibo.com/oauth2/authorize';
const WEIBO_ACCESS_TOKEN_URL = 'https://api.weibo.com/oauth2/access_token';
const WEIBO_TOKEN_INFO_URL = 'https://api.weibo.com/oauth2/get_token_info';
const WEIBO_USER_INFO_URL = 'https://api.weibo.com/2/users/show.json';

const { WEIBO_ID, WEIBO_SECRET } = process.env;

module.exports = class extends Base {

  static check() {
    return WEIBO_ID && WEIBO_SECRET;
  }

  static info() {
    return {
      origin: new URL(WEIBO_AUTHORIZE_URL).hostname
    };
  }

  async redirect() {
    // 来自 client 的参数
    const { redirect: clientRedirect, state: clientState } = this.ctx.params;

    // 你的服务器提供给微博的 redirect_uri
    const weiboAuthRedirectUri = this.getCompleteUrl('/weibo');

    const weiboAuthState = qs.stringify({
      redirect: clientRedirect,
      state: clientState
    });

    const authorizeUrl = WEIBO_AUTHORIZE_URL + '?' + qs.stringify({
      client_id: WEIBO_ID,
      redirect_uri: weiboAuthRedirectUri,
      response_type: 'code',
      state: weiboAuthState
    });

    return this.ctx.redirect(authorizeUrl);
  }

  async getAccessToken(weiboAuthCode) {
    const weiboAuthRedirectUri = this.getCompleteUrl('/weibo');

    const tokenResponse = await fetch(WEIBO_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: qs.stringify({
        client_id: WEIBO_ID,
        client_secret: WEIBO_SECRET,
        grant_type: 'authorization_code',
        code: weiboAuthCode,
        redirect_uri: weiboAuthRedirectUri
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(JSON.stringify(tokenData));

    return tokenData; // 包含 weiboAccessToken
  }

  async getUserInfoByToken({ access_token: weiboAccessToken }) {

    const tokenInfoRes = await fetch(WEIBO_TOKEN_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: qs.stringify({ access_token: weiboAccessToken })
    });

    const weiboTokenInfo = await tokenInfoRes.json();
    if (!tokenInfoRes.ok) throw new Error(JSON.stringify(weiboTokenInfo));

    const userInfoRes = await fetch(
      WEIBO_USER_INFO_URL + '?' + qs.stringify({
        access_token: weiboAccessToken,
        uid: weiboTokenInfo.uid
      })
    );

    const weiboUserInfo = await userInfoRes.json();
    if (!userInfoRes.ok) throw new Error(JSON.stringify(weiboUserInfo));

    const avatarUrl = weiboUserInfo.avatar_large || weiboUserInfo.profile_image_url;
    let avatarBase64 = null;

    if (avatarUrl) {
      const avatarRes = await fetch(avatarUrl, {
        headers: {
          'Referer': avatarUrl,
          'User-Agent': 'Mozilla/5.0'
        }
      });
      const buffer = Buffer.from(await avatarRes.arrayBuffer());
      const mime = avatarRes.headers.get('content-type') || 'image/jpeg';
      avatarBase64 = `data:${mime};base64,${buffer.toString('base64')}`;
    }

    return await this.formatUserResponse({
      id: weiboUserInfo.idstr,
      name: weiboUserInfo.screen_name || weiboUserInfo.name,
      email: undefined,
      url: weiboUserInfo.url || `https://weibo.com/u/${weiboUserInfo.id}`,
      avatar: avatarBase64
    }, 'weibo');
  }
};