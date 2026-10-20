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

  /**
   * Resolve the delivery context for the current request. Providers whose
   * authorization flow encodes the client callback/state differently (e.g.
   * PKCE, OpenID, OIDC multi-state) override this instead of getUserInfo().
   * Returns { callback, ticket }.
   */
  resolveContext() {
    return callbackContext(this.ctx, path => this.getCompleteUrl(path));
  }

  /**
   * Deliver a completed identity to the consumer: a signed/legacy form POST
   * when a callback was resolved, otherwise a direct JSON response.
   */
  deliverSuccess(context, identity) {
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

  /**
   * Deliver an exchange failure: redirect the consumer callback with the error
   * (and ticket) when one was resolved, otherwise return a JSON error body.
   */
  deliverError(context, message, status = 400) {
    const { callback, ticket } = context;
    if (callback) {
      try {
        const destination = new URL(callback);
        destination.searchParams.set('error', message);
        if (ticket) destination.searchParams.set('state', ticket);
        return this.ctx.redirect(destination.href);
      } catch {
        // Invalid callback URL: fall through to a JSON error body.
      }
    }
    this.ctx.status = status;
    this.ctx.body = { error: message };
  }

  async getUserInfo() {
    const code = requestValue(this.ctx, 'code');
    const context = this.resolveContext();
    const error = providerError(this.ctx);

    if (error) return this.deliverError(context, error);
    if (!code) return this.redirect();

    let identity;
    try {
      identity = await this.getUserInfoByToken(await this.getAccessToken(code));
    } catch (exchangeError) {
      return this.deliverError(context, exchangeError.message, 500);
    }

    this.deliverSuccess(context, identity);
  }
}

module.exports = BaseProvider;
