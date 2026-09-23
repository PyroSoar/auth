const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, verify } = require('node:crypto');
const { callbackFields } = require('../src/security/identity-assertion');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const callback = 'https://app.example/api/auth/oauth/callback';
const env = {
  OAUTH_ASSERTION_CALLBACKS: JSON.stringify([callback]),
  OAUTH_ASSERTION_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const identity = { id: 'provider-user', platform: 'github', state: 'browser-transaction', name: '测试用户', email: 'test@example.com', originalResponse: { access_token: 'never-deliver' } };

test('configured callbacks receive only an RSA-signed, short-lived assertion', () => {
  const result = callbackFields(callback, identity, env);
  assert.deepEqual(Object.keys(result), ['assertion']);
  const [header, payload, signature] = result.assertion.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`, 'utf8'), publicKey, Buffer.from(signature, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.equal(claims.sub, identity.id);
  assert.equal(claims.nonce, identity.state);
  assert.equal(claims.aud, callback);
  assert.equal(claims.name, identity.name);
  assert.equal(claims.exp - claims.iat, 120);
  assert.equal(claims.originalResponse, undefined);
  assert.notEqual(claims.jti, JSON.parse(Buffer.from(callbackFields(callback, identity, env).assertion.split('.')[1], 'base64url').toString('utf8')).jti);
});

test('configured callbacks fail closed without a signing key or identity', () => {
  assert.throws(() => callbackFields(callback, identity, { ...env, OAUTH_ASSERTION_PRIVATE_KEY: '' }));
  assert.throws(() => callbackFields(callback, { ...identity, id: '' }, env));
  assert.throws(() => callbackFields(callback, { ...identity, state: '' }, env));
});

test('other consumers retain their existing response format', () => {
  assert.deepEqual(callbackFields('https://comments.example/callback', identity, env), identity);
  assert.deepEqual(callbackFields(callback, identity, {}), identity);
});

test('shared form helper emits the assertion without bare identity fields', async () => {
  const { buildPostForm } = require('../src/delivery/post-form');
  const previous = { callbacks: process.env.OAUTH_ASSERTION_CALLBACKS, key: process.env.OAUTH_ASSERTION_PRIVATE_KEY };
  Object.assign(process.env, env);
  try {
    const html = buildPostForm(callback, identity);
    assert.match(html, /name="assertion"/);
    assert.doesNotMatch(html, /name="(?:id|platform|state|email|originalResponse)"/);
    assert.match(html, /name="color-scheme" content="light dark"/);
    assert.match(html, /@media \(prefers-color-scheme: dark\)/);
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(html, /<noscript>[\s\S]*type="submit">Continue<\/button>/);
    assert.match(html, /data-username="测试用户"/);
    for (const language of ['ar', 'zh', 'fr', 'ru', 'es']) {
      assert.match(html, new RegExp(`${language}: \\{`));
    }
    assert.match(html, /navigator\.languages/);
    assert.match(html, /document\.documentElement\.dir = language === 'ar' \? 'rtl' : 'ltr'/);
  } finally {
    for (const [name, value] of [['OAUTH_ASSERTION_CALLBACKS', previous.callbacks], ['OAUTH_ASSERTION_PRIVATE_KEY', previous.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
