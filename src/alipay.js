const Base = require('./base');
const qs = require('querystring');
const request = require('request-promise-native');
const crypto = require('crypto');
const { requestValue } = require('./services/callback-context');

// Alipay authenticates through a public/private key pair (RSA2):
// requests are signed with the merchant private key, and responses are
// verified with the Alipay public key (or the app's dedicated public key).
const OAUTH_URL = 'https://openauth.alipay.com/oauth2/publicAppAuthorize.htm';
const GATEWAY_URL = 'https://openapi.alipay.com/gateway.do';

const { ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY, ALIPAY_PUBLIC_KEY } = process.env;

// Normalize a PEM key into a form Node's crypto can parse. Environment
// variables (Vercel, etc.) may mangle the key in several ways: literal `\n`
// or `\r\n` sequences instead of real newlines, CRLF line endings, missing
// trailing newlines, or even a fully collapsed single-line body. We extract
// the base64 body by stripping ALL whitespace and literal backslash escapes,
// preserve the original armor type (PKCS#1 "RSA PRIVATE KEY" vs PKCS#8
// "PRIVATE KEY" must not be rewritten, as their DER bodies differ), and
// re-wrap it with canonical newlines.
function normalizePem(key) {
  if (!key) return key;

  const beginMatch = key.match(/-----BEGIN ([^-]+)-----/);
  const endMatch = key.match(/-----END ([^-]+)-----/);
  const armorType = (beginMatch && beginMatch[1]) || 'RSA PRIVATE KEY';

  // Remove the armor lines, then strip every whitespace char and any literal
  // `\n` / `\r` / `\\n` / `\\r` backslash sequences that survived env parsing.
  let body = key
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\\r\\n/g, '')
    .replace(/\\n/g, '')
    .replace(/\\r/g, '')
    .replace(/\s+/g, '');

  if (!body) return key;

  const armored = `-----BEGIN ${armorType}-----\n${body}\n-----END ${armorType}-----`;
  return armored;
}

// Alipay URL-decodes the `state` parameter and re-appends it to the callback
// without re-encoding. If the state payload contains `&` or `=` — as
// querystring encoding does — Alipay's round trip splits it into several
// duplicate `state` parameters and corrupts it. Encode the payload as
// base64url JSON instead: its alphabet (A-Za-z0-9-_) contains no URL
// delimiters, so the value survives Alipay's handling intact.
function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeState(value) {
  if (!value) return null;
  const raw = (Array.isArray(value) ? value.join('&') : String(value)).trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Fall through to the legacy querystring shape.
  }

  // Legacy: state carried as a querystring that Alipay may have split into
  // duplicate `state` params; recover redirect from whichever fragment has it.
  const parsed = qs.parse(raw);
  if (parsed.redirect) return parsed;
  return null;
}

function rsaSign(content, privateKey) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(content, 'utf8');
  return signer.sign(privateKey, 'base64');
}

// Build the canonical sign string: all non-empty params sorted by key, then
// joined as key=value pairs. `sign` itself is never included.
function buildSignString(params) {
  return Object.keys(params)
    .filter(key => key !== 'sign' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
}

// Alipay timestamps must be Beijing time (GMT+8). Serverless platforms such as
// Vercel run in UTC, which is 8 hours behind and beyond Alipay's request
// tolerance, so format explicitly in Asia/Shanghai rather than local time.
function timestamp() {
  const now = new Date();
  const beijingFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const pad = n => String(n).padStart(2, '0');
  const parts = Object.fromEntries(
    beijingFormatter.formatToParts(now).map(p => [p.type, p.value])
  );
  // hourCycle differences can yield "24" for midnight; normalize to "00".
  if (parts.hour === '24') parts.hour = '00';
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ` +
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

// Assemble the common gateway request body, sign it with the merchant private
// key, and POST it to the Alipay gateway.
async function callGateway(method, bizParams) {
  const params = {
    app_id: ALIPAY_APP_ID,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: timestamp(),
    version: '1.0',
    ...bizParams,
  };

  const signString = buildSignString(params);
  params.sign = rsaSign(signString, normalizePem(ALIPAY_PRIVATE_KEY));

  const body = await request.post({
    url: GATEWAY_URL,
    form: params,
    json: true,
  });

  // Alipay returns either `<method>_response` (business result) or
  // `error_response` (gateway-level failure such as a bad signature or a
  // missing parameter). Surface both, including the raw payload, because the
  // business result may omit `code`/`msg` entirely.
  const responseKey = method.replace(/\./g, '_') + '_response';
  const response = body && body[responseKey];
  const gatewayError = body && body.error_response;

  const raw = typeof body === 'string' ? body : JSON.stringify(body);

  if (gatewayError) {
    const err = new Error(
      `[Alipay Gateway Error] ${gatewayError.sub_msg || gatewayError.msg}` +
      ` (${gatewayError.sub_code || gatewayError.code || 'unknown'})`
    );
    err.code = gatewayError.code;
    err.statusCode = 502;
    throw err;
  }

  if (!response) {
    const err = new Error(`[Alipay API Error] Unexpected response: ${raw}`);
    err.statusCode = 500;
    throw err;
  }

  // Some authorization modes (openid / permanent authorization) return the
  // token payload without the usual `code: "10000"` envelope, so treat only an
  // explicitly present non-success code as an error. Presence of business data
  // means the call succeeded.
  if (response.code && response.code !== '10000') {
    const detail =
      response.sub_msg ||
      response.msg ||
      response.sub_code ||
      `code: ${response.code}`;
    const err = new Error(`[Alipay API Error] ${detail}`);
    err.code = response.code;
    err.statusCode = 502;
    throw err;
  }

  return response;
}

module.exports = class extends Base {
  static check() {
    return ALIPAY_APP_ID && ALIPAY_PRIVATE_KEY;
  }

  static info() {
    return { origin: new URL(OAUTH_URL).hostname };
  }

  async redirect() {
    const { redirect, state } = this.ctx.params;
    // Alipay returns the `state` parameter verbatim on the redirect_uri and
    // appends its own callback parameters (auth_code, app_id, scope, ...).
    // Keep redirect_uri bare (no query string) to avoid duplicated `state`
    // segments, and carry the client redirect/state inside Alipay's `state`.
    const redirectUri = this.getCompleteUrl('/alipay');

    const authorizeUrl = OAUTH_URL + '?' + qs.stringify({
      app_id: ALIPAY_APP_ID,
      scope: 'auth_user',
      redirect_uri: redirectUri,
      state: encodeState({ redirect: redirect || '', state: state || '' }),
    });

    // The authorization page only works on PC or inside the Alipay client; a
    // mobile browser outside the client is rejected with "请在支付宝客户端打开链接".
    // There, hand off to the official alipays scheme instead: 20000067 is
    // Alipay's built-in web-jump app, and wrapping the scheme in
    // https://ds.alipay.com/?scheme= gives browsers an HTTPS link to open.
    const ua = this.ctx.header?.['user-agent'] || '';
    const inAlipayClient = /AlipayClient/i.test(ua);
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    if (!isMobile || inAlipayClient) {
      return this.ctx.redirect(authorizeUrl);
    }

    const scheme = `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(authorizeUrl)}`;
    return this.ctx.redirect(`https://ds.alipay.com/?scheme=${encodeURIComponent(scheme)}`);
  }

  // Alipay returns the authorization code as `auth_code` (not `code`), and the
  // client callback/ticket are recovered from the base64url `state` payload.
  resolveContext() {
    const parsed = decodeState(requestValue(this.ctx, 'state')) || {};
    let callback = parsed.redirect || null;
    // Match base behavior so relative callbacks resolve against SERVER_URL.
    if (callback && !/^https?:\/\//i.test(callback)) {
      callback = this.getCompleteUrl(callback.startsWith('/') ? callback : `/${callback}`);
    }
    return {
      callback: callback || null,
      ticket: parsed.state || '',
    };
  }

  async getUserInfo() {
    const code = requestValue(this.ctx, 'auth_code');
    const context = this.resolveContext();

    if (!code) return this.redirect();

    let identity;
    try {
      identity = await this.getUserInfoByToken(await this.getAccessToken(code));
    } catch (exchangeError) {
      return this.deliverError(context, exchangeError.message, 500);
    }

    this.deliverSuccess(context, identity);
  }

  async getAccessToken(code) {
    const response = await callGateway('alipay.system.oauth.token', {
      grant_type: 'authorization_code',
      code,
    });

    return {
      access_token: response.access_token,
      user_id: response.user_id,
      open_id: response.open_id,
      refresh_token: response.refresh_token,
      expires_in: response.expires_in,
      re_expires_in: response.re_expires_in,
    };
  }

  async getUserInfoByToken({ access_token, user_id, open_id }) {
    const info = await callGateway('alipay.user.info.share', {
      auth_token: access_token,
    });

    return await this.formatUserResponse({
      id: open_id || info.open_id || info.user_id || user_id,
      name: info.nick_name || '支付宝用户',
      email: undefined,
      url: undefined,
      avatar: info.avatar || undefined,
      originalResponse: info,
    }, 'alipay');
  }
};
