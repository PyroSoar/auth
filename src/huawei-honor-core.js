// Shared core for HONOR / Huawei account services.
//
// The two platforms are the same implementation wearing different clothes:
// an OAuth 2.0 authorization-code flow at `/oauth2/v3/authorize` and
// `/oauth2/v3/token`, plus the same `nsp_svc=GOpen.User.getInfo` profile call
// that Huawei originally designed. Only the hosts differ. Everything except
// hosts, credentials, route name and transport choice therefore lives here,
// and `src/huawei.js` / `src/honor.js` are thin declarations.
//
// Two related platform details drive the design:
//
// 1. redirect_uri must be byte-identical across authorize and token exchange,
//    or the provider rejects with error 1101 / sub_error 20024. A single
//    `authorizeRedirectUri()` builds it for both phases so they cannot drift.
// 2. `state` is validated against ^[0-9a-zA-Z:/._-]{1,255}$. Anything carrying
//    `=`, `&` or `%` is refused with 1101 / 20031 before a login page renders.
//    Both transports exist only because of this: `query-redirect` keeps state
//    as the raw consumer ticket (Huawei's original approach) while
//    `encoded-state` packs the callback into base64url JSON (HONOR).
const Base = require('./base');
const qs = require('querystring');
const request = require('request-promise-native');
const { jwtDecode } = require('jwt-decode');
const { callbackContext, requestValue } = require('./services/callback-context');

const AUTHORIZE_PATH = '/oauth2/v3/authorize';
const TOKEN_PATH = '/oauth2/v3/token';
// The profile endpoint is the old Huawei `nsp_svc` gateway rather than REST.
const USER_INFO_PATH = '/rest.php?nsp_svc=GOpen.User.getInfo';

// Scopes are space separated and stay URL-encoded as a whole; qs.stringify
// emits `%20`, matching the documented authorize link. `access_type=offline`
// appears in the vendor samples but only buys a refresh token this service
// never uses, so it is left out.
const SCOPES = 'openid profile email';

const MAX_STATE_LENGTH = 255;
const STATE_TTL_MS = 10 * 60 * 1000;

// Query values arrive as strings or arrays depending on how many times the
// parameter appeared in the URL.
function flat(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === undefined || raw === null ? '' : String(raw);
}

// These providers echo codes and access tokens back with `\` escapes; their
// docs require stripping them before use. URL-encoding stays with the client.
function unescapeValue(value) {
  return typeof value === 'string' ? value.replace(/\\/g, '') : value;
}

// base64url has no URL delimiters and Node emits it without `=` padding, so an
// encoded payload clears the state whitelist that a querystring would fail.
function encodeState(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  // Nothing further can be done here — a longer value means a longer consumer
  // callback than the provider accepts — so log it and let the provider report
  // its own error.
  if (encoded.length > MAX_STATE_LENGTH) {
    console.warn(`[HONOR/Huawei] encoded state is ${encoded.length} chars, above the provider's 255 limit`);
  }
  return encoded;
}

function decodeState(value) {
  const raw = flat(value);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // Not ours: duplicated state parameter, hand-crafted callback, truncation.
    return null;
  }
}

// Failures are numeric rather than HTTP-shaped, e.g.
// { error: 1101, sub_error: 20023, error_description: 'The request is invalid' }
function providerError(platform, label, body, defaultStatus = 502) {
  const codes = [body?.error, body?.sub_error]
    .filter(value => value !== undefined && value !== '')
    .join('.');
  const detail = body?.error_description || body?.sub_description ||
    (codes ? `code: ${codes}` : undefined);
  const error = new Error(`[${platform} ${label}] ${detail || 'request failed'}`);
  error.code = body?.error;
  error.statusCode = defaultStatus;
  return error;
}

// The id_token is a secondary source: it fills gaps the profile endpoint
// leaves rather than being trusted on its own, so failures degrade quietly.
function decodeIdToken(idToken) {
  if (!idToken) return {};
  try {
    return jwtDecode(idToken) || {};
  } catch (error) {
    console.warn('[HONOR/Huawei] id_token decode failed:', error?.message);
    return {};
  }
}

class AccountKitProvider extends Base {
  constructor(ctx, config) {
    super(ctx);
    this.config = config;
  }

  get platform() {
    return this.config.platform;
  }

  get transport() {
    return this.config.transport || 'encoded-state';
  }

  get authorizeUrl() {
    return `https://${this.config.loginHost}${AUTHORIZE_PATH}`;
  }

  /**
   * The consumer callback, whichever way it reached us: directly as a request
   * parameter, or recovered from the state bridge used by `query-redirect`.
   */
  consumerRedirect() {
    const direct = flat(requestValue(this.ctx, 'redirect'));
    if (direct) return direct;
    if (this.transport !== 'query-redirect') return '';
    const state = flat(requestValue(this.ctx, 'state'));
    return state ? (this.config.stateBridge.get(state)?.redirect || '') : '';
  }

  /**
   * The redirect_uri handed to the provider and repeated verbatim at the token
   * exchange. Called from both phases so the two values cannot drift apart.
   */
  authorizeRedirectUri(consumerRedirect) {
    const base = this.getCompleteUrl(this.config.callbackPath);
    if (this.transport !== 'query-redirect' || !consumerRedirect) return base;
    return base + '?' + qs.stringify({ redirect: consumerRedirect });
  }

  async redirect() {
    const consumerRedirect = flat(requestValue(this.ctx, 'redirect'));
    const ticket = flat(requestValue(this.ctx, 'state'));
    const wantsBridge = this.transport === 'query-redirect' && consumerRedirect;

    if (wantsBridge) this.#remember(ticket, consumerRedirect);

    const state = this.transport === 'query-redirect'
      ? ticket
      : encodeState({ redirect: consumerRedirect, state: ticket });

    return this.ctx.redirect(this.authorizeUrl + '?' + qs.stringify({
      client_id: this.config.clientId,
      redirect_uri: this.authorizeRedirectUri(consumerRedirect),
      response_type: 'code',
      scope: SCOPES,
      state,
    }));
  }

  // `encoded-state` carries the callback inside the provider state instead of
  // as a request parameter, so the default resolution does not apply.
  resolveContext() {
    if (this.transport !== 'encoded-state') {
      return callbackContext(this.ctx, path => this.getCompleteUrl(path));
    }

    const payload = decodeState(requestValue(this.ctx, 'state')) || {};
    let callback = payload.redirect || null;
    // Keep the base behavior of resolving relative callbacks from SERVER_URL.
    if (callback && !/^https?:\/\//i.test(callback)) {
      callback = this.getCompleteUrl(callback.startsWith('/') ? callback : `/${callback}`);
    }
    return { callback: callback || null, ticket: payload.state || '' };
  }

  async getAccessToken(code) {
    const tokenInfo = await request.post({
      url: `https://${this.config.loginHost}${TOKEN_PATH}`,
      form: {
        grant_type: 'authorization_code',
        code: unescapeValue(flat(code)),
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.authorizeRedirectUri(this.consumerRedirect()),
      },
      json: true,
    });

    if (tokenInfo.error) throw providerError(this.platform, 'Token Error', tokenInfo, 401);
    if (!tokenInfo.access_token) {
      throw providerError(this.platform, 'Token Error', {
        error_description: 'missing access_token in response',
      });
    }

    // The state bridge exists only to rebuild redirect_uri; once the code has
    // been exchanged it must not resolve again.
    if (this.transport === 'query-redirect') {
      this.config.stateBridge.delete(flat(requestValue(this.ctx, 'state')));
    }

    return tokenInfo;
  }

  async getUserInfoByToken(tokenInfo) {
    const claims = decodeIdToken(tokenInfo.id_token);
    // Preferred source. If it is unavailable the login still completes from
    // the id_token, which is all Huawei relied on historically.
    const profile = await this.#fetchProfile(tokenInfo.access_token);

    const id = profile?.openID || claims.open_id || claims.union_id || claims.sub || claims.openid;

    const identity = {
      id,
      // Huawei historically fell back to `sub` for a display name, so keep an
      // identifier-based fallback at the end rather than failing validation.
      name: profile?.displayName || claims.display_name || claims.nickname || claims.name || id,
      email: profile?.email || claims.email || undefined,
      url: undefined,
      avatar: profile?.headPictureURL || claims.picture || claims.picture_url || undefined,
      // The legacy shape kept every id_token claim at the top level, so spread
      // them rather than nesting, and add the profile alongside when present.
      originalResponse: { ...claims, ...(profile ? { profile } : {}) },
    };

    if (!identity.id) {
      throw providerError(this.platform, 'Profile Error', {
        error_description: 'no identifier in profile or id_token',
      });
    }

    return this.formatUserResponse(identity, this.platform);
  }

  async #fetchProfile(accessToken) {
    if (!accessToken) return null;

    try {
      const response = await request.post({
        url: `https://${this.config.profileHost}${USER_INFO_PATH}`,
        form: {
          access_token: unescapeValue(accessToken),
          // 1 prefers the real nickname over the anonymized account string.
          getNickName: 1,
        },
        json: true,
      });

      if (response?.error) {
        console.warn(
          `[${this.platform}] profile request rejected, falling back to id_token:`,
          JSON.stringify(response)
        );
        return null;
      }
      return response;
    } catch (error) {
      console.warn(`[${this.platform}] profile request failed, falling back to id_token:`, error.message);
      return null;
    }
  }

  // `query-redirect` needs this because a token exchange can arrive without
  // the callback on the URL, having kept only the state. Serverless instances
  // make timers pointless, so entries expire lazily and are swept on write.
  #remember(ticket, redirect) {
    const bridge = this.config.stateBridge;
    const now = Date.now();
    for (const [key, entry] of bridge) {
      if (now - entry.ts > STATE_TTL_MS) bridge.delete(key);
    }
    bridge.set(ticket, { redirect, ts: now });
  }
}

/**
 * Build an adapter class around its platform configuration.
 *
 * @param {Object} config
 * @param {string} config.platform   Normalized platform name.
 * @param {string} config.callbackPath Route this provider is served on, e.g. `/honor`.
 * @param {string} config.loginHost  Host serving authorize and token endpoints.
 * @param {string} config.profileHost Host serving `GOpen.User.getInfo`.
 * @param {string} config.clientId   App id from the developer console.
 * @param {string} config.clientSecret App secret from the developer console.
 * @param {'encoded-state'|'query-redirect'} [config.transport] Where the consumer callback travels.
 */
module.exports = function createAccountKitProvider(config) {
  const options = {
    transport: 'encoded-state',
    stateBridge: new Map(),
    ...config,
  };

  return class extends AccountKitProvider {
    static check() {
      return Boolean(options.clientId && options.clientSecret);
    }

    static info() {
      return { origin: options.loginHost };
    }

    constructor(ctx) {
      super(ctx, options);
    }
  };
};
