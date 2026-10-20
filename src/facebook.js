const Base = require('./base');
const qs = require('querystring');
const request = require('request-promise-native');

const OAUTH_URL       = 'https://www.facebook.com/v4.0/dialog/oauth';
const ACCESS_TOKEN_URL = 'https://graph.facebook.com/v4.0/oauth/access_token';
const USER_INFO_URL   = 'https://graph.facebook.com/me';

const { FACEBOOK_ID, FACEBOOK_SECRET } = process.env;

module.exports = class extends Base {
  static check() { return FACEBOOK_ID && FACEBOOK_SECRET; }
  static info()  { return { origin: new URL(OAUTH_URL).hostname }; }

  async getAccessToken(code) {
    const { state } = this.ctx.params;
    return request.post({
      url: ACCESS_TOKEN_URL,
      headers: { 'Accept': 'application/json' },
      form: {
        client_id: FACEBOOK_ID,
        client_secret: FACEBOOK_SECRET,
        code,
        redirect_uri: this.getCompleteUrl('/facebook') + '?' + qs.stringify({ state })
      },
      json: true
    });
  }

  async getUserInfoByToken({ access_token }) {
    const user = await request({
      url: USER_INFO_URL + '?' + qs.stringify({
        access_token,
        fields: ['id', 'name', 'email', 'picture', 'link'].join()
      }),
      method: 'GET',
      json: true,
    });

    let avatar;
    if (typeof user.picture === 'object' && user.picture?.data?.url) {
      avatar = user.picture.data.url;
    } else if (typeof user.picture === 'string') {
      avatar = user.picture;
    }

    return await this.formatUserResponse({
      id: user.id,
      name: user.name,
      email: user.email || undefined,
      url: user.link || undefined,
      avatar: avatar || undefined,
      originalResponse: user
    }, 'facebook');
  }

  async redirect() {
    const { redirect, state } = this.ctx.params;
    const redirectUrl = this.getCompleteUrl('/facebook') + '?' + qs.stringify({
      state: qs.stringify({ redirect, state })
    });
    const url = OAUTH_URL + '?' + qs.stringify({
      client_id: FACEBOOK_ID,
      redirect_uri: redirectUrl,
      scope: ['email'].join(),
      response_type: 'code',
      auth_type: 'rerequest',
      display: 'popup',
    });
    return this.ctx.redirect(url);
  }
};
