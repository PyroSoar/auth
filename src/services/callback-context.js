const qs = require('querystring');

const requestValue = (ctx, name) => ctx.query?.[name] ?? ctx.params?.[name];

function callbackContext(ctx, completeUrl) {
  let redirect = requestValue(ctx, 'redirect');
  let ticket = requestValue(ctx, 'state');
  if (!redirect && ticket) {
    const encoded = qs.parse(ticket);
    redirect = encoded.redirect || redirect;
    ticket = encoded.state || ticket;
  }
  if (redirect && !/^https?:\/\//i.test(redirect)) {
    redirect = completeUrl(redirect.startsWith('/') ? redirect : `/${redirect}`);
  }
  return { callback: redirect || null, ticket };
}

function providerError(ctx) {
  const code = requestValue(ctx, 'error');
  if (!code) return null;
  const description = requestValue(ctx, 'error_description');
  return description ? `${code}: ${description}` : code;
}

module.exports = { callbackContext, providerError, requestValue };
