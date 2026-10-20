const Base = require('./base');
const qs = require('querystring');
const request = require('request-promise-native');

const OAUTH_URL = 'https://orcid.org/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://orcid.org/oauth/token';

const { ORCID_ID, ORCID_SECRET } = process.env;

module.exports = class extends Base {
  static check() {
    return ORCID_ID && ORCID_SECRET;
  }

  static info() {
    return {
      origin: new URL(OAUTH_URL).hostname
    };
  }

  async getAccessToken(code) {
    return request.post({
      url: ACCESS_TOKEN_URL,
      headers: { Accept: 'application/json' },
      form: {
        client_id: ORCID_ID,
        client_secret: ORCID_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.getCompleteUrl('/orcid')
      },
      json: true
    });
  }

  async getUserInfoByToken(token) {
    if (token.error) {
      const err = new Error(`[ORCID Token Error] ${token.error_description || token.error}`);
      err.code = token.error;
      throw err;
    }

    const { orcid, name, access_token } = token;
    const extras = await this.#fetchPublicRecord(orcid, access_token);

    return await this.formatUserResponse({
      id: orcid,
      name: name || orcid,
      email: undefined,
      url: orcid ? `https://orcid.org/${orcid}` : undefined,
      avatar: undefined,
      originalResponse: { ...token, ...extras }
    }, 'orcid');
  }

  // Best-effort enrichment from ORCID's public API. A failure here must never
  // break the login, so each request degrades to null on error.
  async #fetchPublicRecord(orcid, accessToken) {
    if (!orcid) return {};
    const base = `https://pub.orcid.org/v3.0/${orcid}`;
    const headers = { Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const get = path => request.get({
      url: `${base}/${path}`,
      headers,
      json: true
    }).catch(error => {
      console.warn(`[orcid] public API ${path} failed:`, error.message);
      return null;
    });

    const [works, person] = await Promise.all([get('works'), get('person')]);
    return {
      works: works || undefined,
      person: person || undefined
    };
  }

  async redirect() {
    const { redirect, state } = this.ctx.params;
    const url = OAUTH_URL + '?' + qs.stringify({
      client_id: ORCID_ID,
      redirect_uri: this.getCompleteUrl('/orcid'),
      response_type: 'code',
      scope: '/authenticate',
      state: qs.stringify({ redirect, state })
    });
    return this.ctx.redirect(url);
  }
};
