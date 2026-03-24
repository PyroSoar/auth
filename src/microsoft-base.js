const Base = require('./base');
const qs = require('querystring');
const request = require('request-promise-native');

const { MS_client_Id, MS_client_secret, MS_tenant_Id } = process.env;
const USER_INFO_URL = 'https://graph.microsoft.com/v1.0/me';
const USER_PHOTO_URL = 'https://graph.microsoft.com/v1.0/me/photo/$value';

class MicrosoftBase extends Base {
  constructor(ctx, providerName, tenant) {
    super(ctx);
    this.providerName = providerName;
    this.tenant = tenant;
  }

  static check() {
    return MS_client_Id && MS_client_secret;
  }

  static info() {
    return {
      origin: 'login.microsoftonline.com'
    };
  }

  getOAuthUrl() {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`;
  }

  getAccessTokenUrl() {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
  }

  async getAccessToken(code) {
    const params = {
      client_id: MS_client_Id,
      client_secret: MS_client_secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.getCompleteUrl(`/${this.providerName}`)
    };

    return request.post({
      url: this.getAccessTokenUrl(),
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      form: params,
      json: true
    });
  }

  async getUserInfoByToken({ access_token }) {
    const user = await request({
      url: USER_INFO_URL,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${access_token}`
      },
      json: true
    });

    let email = user.mail || user.userPrincipalName || undefined;
    if (email && email.includes('#EXT#@')) {
      const parts = email.split('#EXT#@');
      if (parts.length > 0) {
        email = parts[0].replace(/_/g, '@');
      }
    }

    let avatar;
    console.log(`[${this.providerName}] Attempting to fetch user photo from:`, USER_PHOTO_URL);
    try {
      const photoResponse = await request({
        url: USER_PHOTO_URL,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`
        },
        encoding: null,
        resolveWithFullResponse: true
      });
      console.log(`[${this.providerName}] Photo response status:`, photoResponse.statusCode);
      console.log(`[${this.providerName}] Photo response content-type:`, photoResponse.headers['content-type']);
      console.log(`[${this.providerName}] Photo buffer size:`, photoResponse.body ? photoResponse.body.length : 0);
      
      if (photoResponse.body && photoResponse.body.length > 0) {
        const contentType = photoResponse.headers['content-type'] || 'image/jpeg';
        avatar = `data:${contentType};base64,${photoResponse.body.toString('base64')}`;
        console.log(`[${this.providerName}] Avatar base64 length:`, avatar.length);
      }
    } catch (e) {
      console.log(`[${this.providerName}] Failed to fetch user photo:`, e.message);
      console.log(`[${this.providerName}] Error details:`, e.statusCode);
    }

    return await this.formatUserResponse({
      id: user.id,
      name: user.displayName || user.userPrincipalName,
      email,
      url: undefined,
      avatar,
      originalResponse: user
    }, this.providerName);
  }

  async redirect() {
    const { redirect, state } = this.ctx.params;
    const redirectUrl = this.getCompleteUrl(`/${this.providerName}`);

    const url = this.getOAuthUrl() + '?' + qs.stringify({
      client_id: MS_client_Id,
      redirect_uri: redirectUrl,
      scope: 'openid profile email User.Read',
      response_type: 'code',
      response_mode: 'query',
      state: qs.stringify({ redirect, state })
    });
    return this.ctx.redirect(url);
  }
}

module.exports = MicrosoftBase;