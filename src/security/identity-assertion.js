const { createPrivateKey, randomUUID, sign } = require('node:crypto');

const DATA_IMAGE_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+\/]+={0,2})$/;

// Providers return three avatar shapes: an HTTPS URL (GitHub, Google), an HTTP
// URL (QQ), and an inline base64 image (Microsoft, Weibo). HTTP URLs are
// rewritten to HTTPS so consumers never have to load mixed content. Avatar
// length is unbounded: providers choose the resolution they return, and the
// value is display-only, so capping it would only drop valid avatars. Anything
// that is neither an HTTP(S) URL nor a base64 image is omitted.
function avatarClaim(value) {
  if (typeof value !== 'string' || !value) return null;
  const upgraded = value.replace(/^http:\/\//, 'https://');
  if (upgraded.startsWith('https://')) return upgraded;
  const inline = upgraded.replace(/\s+/g, '');
  const payload = DATA_IMAGE_URL.exec(inline)?.[1];
  if (!payload || payload.length % 4) return null;
  return inline;
}

// Only explicitly configured consumers receive signed assertions. Other clients
// retain their existing response contract; account consumers must reject that format.
function callbackFields(callback, identity, env = process.env) {
  const callbacks = JSON.parse(env.OAUTH_ASSERTION_CALLBACKS || '[]');
  if (!Array.isArray(callbacks) || callbacks.some(value => typeof value !== 'string')) {
    throw new Error('OAUTH_ASSERTION_CALLBACKS must be a JSON array of exact callback URLs');
  }
  if (!callbacks.includes(callback)) return identity;

  const destination = new URL(callback);
  if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash) {
    throw new Error('Signed OAuth callbacks must use HTTPS');
  }
  if (!env.OAUTH_ASSERTION_PRIVATE_KEY) throw new Error('OAuth assertion signing key is missing');

  const key = createPrivateKey(env.OAUTH_ASSERTION_PRIVATE_KEY.replace(/\\n/g, '\n'));
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) {
    throw new Error('OAuth assertions require an RSA key of at least 2048 bits');
  }
  for (const field of ['id', 'platform', 'state']) {
    if (typeof identity[field] !== 'string' || !identity[field] || identity[field].length > 512) {
      throw new Error(`Invalid OAuth identity field: ${field}`);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.OAUTH_ASSERTION_ISSUER || 'https://oauth.lzc2002.top',
    aud: callback,
    sub: identity.id,
    platform: identity.platform,
    nonce: identity.state,
    iat: now,
    exp: now + 120,
    jti: randomUUID(),
    name: typeof identity.name === 'string' ? identity.name.slice(0, 200) : null,
    email: typeof identity.email === 'string' ? identity.email.slice(0, 320) : null,
    avatar: avatarClaim(identity.avatar),
  };
  const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
  const signature = sign('RSA-SHA256', Buffer.from(input, 'utf8'), key).toString('base64url');
  return { assertion: `${input}.${signature}` };
}

module.exports = { callbackFields };
