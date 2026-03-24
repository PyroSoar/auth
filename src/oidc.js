const Base = require('./base');
const qs = require('querystring');
const request = require('request-promise-native');
const { buildPostForm } = Base;

const {
  OIDC_ID, OIDC_SECRET, OIDC_ISSUER, OIDC_SCOPES,
  OIDC_AUTH_URL, OIDC_TOKEN_URL, OIDC_USERINFO_URL
} = process.env;

let discovery;
async function getDiscovery() {
  if (discovery) return discovery;
  const issuer = (OIDC_ISSUER || '').replace(/\/+$/, '');
  if (!issuer && !(OIDC_AUTH_URL && OIDC_TOKEN_URL && OIDC_USERINFO_URL)) {
    throw new Error('Missing OIDC_ISSUER or explicit endpoints');
  }
  if (OIDC_AUTH_URL && OIDC_TOKEN_URL && OIDC_USERINFO_URL) {
    discovery = {
      authorization_endpoint: OIDC_AUTH_URL,
      token_endpoint: OIDC_TOKEN_URL,
      userinfo_endpoint: OIDC_USERINFO_URL,
    };
    return discovery;
  }
  discovery = await request.get(issuer + '/.well-known/openid-configuration', { json: true });
  return discovery;
}

module.exports = class extends Base {
  static check() {
    if (!OIDC_ID || !OIDC_SECRET) return false;
    return OIDC_ISSUER || (OIDC_AUTH_URL && OIDC_TOKEN_URL && OIDC_USERINFO_URL);
  }

  static info() {
    return { origin: new URL(OIDC_ISSUER || OIDC_AUTH_URL).hostname };
  }

  async redirect() {
    const { redirect, state } = this.ctx.params;
    const { authorization_endpoint } = await getDiscovery();
    const url = authorization_endpoint + '?' + qs.stringify({
      client_id: OIDC_ID,
      redirect_uri: redirect,
      response_type: 'code',
      scope: OIDC_SCOPES || 'openid profile email',
      state: typeof state === 'string' ? state : '',
    });
    return this.ctx.redirect(url);
  }

  async getAccessToken(code) {
    const { redirect } = this.ctx.params;
    const { token_endpoint } = await getDiscovery();
    return request.post({
      url: token_endpoint,
      form: {
        client_id: OIDC_ID,
        client_secret: OIDC_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
      },
      json: true,
    });
  }

  async getUserInfoByToken({ access_token }) {
    const { userinfo_endpoint } = await getDiscovery();
    const user = await request({
      url: userinfo_endpoint,
      method: 'GET',
      headers: { Authorization: `Bearer ${access_token}` },
      json: true,
    });

    const rawAvatar = user.picture || user.avatar;
    const avatar = typeof rawAvatar === 'string'
      ? rawAvatar.trim().replace(/^`+|`+$/g, '').replace(/^"+|"+$/g, '')
      : undefined;
    const profileUrl = user.profile || user.website || (typeof user.url === 'string' ? user.url : '');

    return await this.formatUserResponse({
      id: user.sub,
      name: user.name || user.preferred_username || user.nickname,
      email: user.email || undefined,
      url: profileUrl || undefined,
      avatar: avatar || undefined,
      originalResponse: user
    }, 'oidc');
  }

  async getUserInfo() {
    const { code, state: _state, redirect: directRedirect } = this.ctx.params;
    const parsed = qs.parse(_state || '');
    if ((!parsed.redirect || typeof parsed.redirect !== 'string') && this.ctx.search) {
      const search = this.ctx.search.slice(1);
      const states = (search.match(/(?:^|&)state=([^&]*)/g) || [])
        .map((s) => decodeURIComponent(s.split('=')[1] || ''));
      const picked = states.find((v) => v && /redirect=/.test(v)) || states.find((v) => v) || '';
      if (picked) Object.assign(parsed, qs.parse(picked));
    }
    const redirect = parsed.redirect || directRedirect;
    const state = parsed.state || '';

    if (!code) return this.redirect();

    this.ctx.type = 'json';
    let userInfo;
    try {
      const accessTokenInfo = await this.getAccessToken(code);
      userInfo = await this.getUserInfoByToken(accessTokenInfo);
    } catch (error) {
      if (redirect) {
        const errUrl = new URL(redirect);
        errUrl.searchParams.set('error', error.message);
        if (state) errUrl.searchParams.set('state', state);
        return this.ctx.redirect(errUrl.toString());
      }
      this.ctx.status = 500;
      this.ctx.body = { error: error.message };
      return;
    }

    if (redirect) {
      const payload = { ...userInfo };
      if (state) payload.state = state;
      this.ctx.type = 'html';
      this.ctx.body = buildPostForm(redirect, payload);
      return;
    }

    return this.ctx.body = userInfo;
  }
};
