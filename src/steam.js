const Base = require('./base');
const qs = require('querystring');
const request = require('request-promise-native');

const OPENID_CHECK_URL = 'https://steamcommunity.com/openid/login';
const PLAYER_SUMMARY_URL = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';

const { STEAM_KEY } = process.env;

module.exports = class extends Base {
  static check() { return !!STEAM_KEY; }
  static info() { return { origin: new URL(PLAYER_SUMMARY_URL).hostname }; }

  /**
   * Step 1: Redirect to Steam's OpenID login page.
   * openid.return_to points back at THIS service's /steam endpoint so the
   * service can verify and fetch user info before reaching the client.
   */
  async redirect() {
    const clientRedirect = this.ctx.query?.redirect || this.ctx.params?.redirect;
    const state = this.ctx.query?.state || this.ctx.params?.state;

    if (!clientRedirect) {
      this.ctx.type = 'json';
      this.ctx.body = {
        status: 'online',
        service: 'Steam OpenID Adapter',
        message: 'This endpoint is for OAuth authentication. Please initiate login from your application.'
      };
      return;
    }

    // return_to points at this service with the client redirect + state as passthrough
    const returnTo = this.getCompleteUrl('/steam') + '?' + qs.stringify({
      redirect: clientRedirect,
      state: state || ''
    });

    const params = {
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': this.getCompleteUrl('/'),
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    };

    return this.ctx.redirect(OPENID_CHECK_URL + '?' + qs.stringify(params));
  }

  /** Step 2: Verify the OpenID assertion with Steam */
  async getAccessToken() {
    const queryParams = this.ctx.query || this.ctx.params;
    const params = { ...queryParams, 'openid.mode': 'check_authentication' };

    console.log('[Steam] Verifying with Steam API...');
    const response = await request.post({ url: OPENID_CHECK_URL, form: params });

    if (!response.includes('is_valid:true')) {
      throw new Error('Steam OpenID verification failed');
    }

    const steamId = params['openid.claimed_id'].split('/').pop();
    console.log('[Steam] Verified SteamID:', steamId);
    return { steamId };
  }

  /** Step 3: Fetch player summary */
  async getUserInfoByToken({ steamId }) {
    const data = await request.get({
      url: PLAYER_SUMMARY_URL,
      qs: { key: STEAM_KEY, steamids: steamId },
      json: true,
    });

    const player = data.response.players[0];
    if (!player) throw new Error('Failed to fetch Steam user profile');

    return await this.formatUserResponse({
      id: player.steamid,
      name: player.personaname,
      email: undefined,
      url: player.profileurl,
      avatar: player.avatarfull,
      originalResponse: player
    }, 'steam');
  }

  /**
   * One-phase getUserInfo override for Steam OpenID 2.0.
   * Steam calls back here; service verifies, fetches user info,
   * then POSTs user data to the client's callback URL.
   */
  async getUserInfo() {
    const queryParams = this.ctx.query || this.ctx.params;
    const openidMode = queryParams['openid.mode'];

    if (!openidMode || openidMode === 'checkid_setup') return this.redirect();

    const clientRedirect = queryParams.redirect;
    const state = queryParams.state;

    let userInfo;
    try {
      const tokenInfo = await this.getAccessToken();
      userInfo = await this.getUserInfoByToken(tokenInfo);
    } catch (error) {
      console.error('[Steam] Error:', error.message);
      return this.deliverError({ callback: clientRedirect, ticket: state }, error.message, 500);
    }

    // One-phase: POST user data to client callback, or return JSON directly
    this.deliverSuccess({ callback: clientRedirect, ticket: state }, userInfo);
  }
};
