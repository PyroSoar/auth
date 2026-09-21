const { buildPostForm } = require('./delivery/post-form');
const { callbackContext, providerError, requestValue } = require('./services/callback-context');
const { normalizeProfile } = require('./services/profile-service');

class BaseProvider {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async formatUserResponse(profile, platform = '') {
    return normalizeProfile(profile, platform);
  }

  getCompleteUrl(path = '') {
    const protocol = this.ctx?.header?.['x-forwarded-proto'] || 'http';
    const host = this.ctx?.header?.['x-forwarded-host'] || this.ctx?.host || '';
    const base = process.env.SERVER_URL || `${protocol}://${host}`;
    return base + (path.startsWith('/') ? path : `/${path}`);
  }

  async getUserInfo() {
    const code = requestValue(this.ctx, 'code');
    const context = callbackContext(this.ctx, path => this.getCompleteUrl(path));
    const error = providerError(this.ctx);

    if (error) return this.#deliverError(context, error);
    if (!code) return this.redirect();

    let identity;
    try {
      identity = await this.getUserInfoByToken(await this.getAccessToken(code));
    } catch (exchangeError) {
      return this.#deliverError(context, exchangeError.message, 500);
    }

    if (!context.callback) {
      this.ctx.type = 'json';
      this.ctx.body = identity;
      return;
    }

    this.ctx.type = 'html';
    this.ctx.body = buildPostForm(context.callback, {
      ...identity,
      ...(context.ticket ? { state: context.ticket } : {}),
    });
  }

  #deliverError({ callback, ticket }, message, status = 400) {
    if (callback) {
      const destination = new URL(callback);
      destination.searchParams.set('error', message);
      if (ticket) destination.searchParams.set('state', ticket);
      return this.ctx.redirect(destination.href);
    }
    this.ctx.status = status;
    this.ctx.body = { error: message };
  }
}

module.exports = BaseProvider;
