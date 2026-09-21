const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { callbackFields } = require('../src/security/identity-assertion');
const { createLoginExample, verifyAssertion } = require('../INTEGRATION_EXAMPLES');

const origin = 'https://app.example';
const callbackUrl = origin + '/oauth/callback';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

function store() {
  const records = new Map();
  return {
    async issue(row) {
      if (records.has(row.ticket)) throw new Error('duplicate ticket');
      records.set(row.ticket, row);
    },
    async attachIdentity({ ticket, provider, identity, expiresAt, now }) {
      const row = records.get(ticket);
      if (!row || row.provider !== provider || row.expiresAt <= now || row.identity) return false;
      row.identity = identity;
      row.expiresAt = Math.min(row.expiresAt, expiresAt);
      return true;
    },
    async redeem({ ticket, browserHash, now }) {
      const row = records.get(ticket);
      if (!row || row.browserHash !== browserHash || row.expiresAt <= now || !row.identity) return null;
      records.delete(ticket);
      return row.identity;
    },
  };
}

test('usage example verifies, browser-binds, and consumes a signed login once', async () => {
  const oauth = createLoginExample({
    origin, publicKeyPem, ticketStore: store(),
    createSessionToken: async identity => {
      assert.equal(identity.id, 'provider-user');
      return 'a'.repeat(48);
    },
  });
  const start = await oauth.start(new Request(origin + '/oauth/start', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'github' }),
  }));
  assert.equal(start.status, 200);
  const startData = await start.json();
  const ticket = new URL(startData.authUrl).searchParams.get('state');
  const browserCookie = start.headers.get('Set-Cookie').split(';')[0];
  const assertion = callbackFields(callbackUrl, {
    id: 'provider-user', platform: 'github', state: ticket, name: 'Example User',
    originalResponse: { id: 'provider-user', login: 'example' },
  }, { OAUTH_ASSERTION_CALLBACKS: JSON.stringify([callbackUrl]), OAUTH_ASSERTION_PRIVATE_KEY: privateKeyPem }).assertion;
  assert.equal(verifyAssertion(assertion, publicKey, callbackUrl).sub, 'provider-user');

  const callback = await oauth.callback(new Request(callbackUrl, {
    method: 'POST', body: new URLSearchParams({ assertion }),
  }));
  assert.equal(callback.status, 303);
  const resultCookie = callback.headers.get('Set-Cookie').split(';')[0];
  const completeRequest = () => new Request(origin + '/oauth/complete', {
    method: 'POST', headers: { Origin: origin, Cookie: browserCookie + '; ' + resultCookie },
  });
  assert.equal((await oauth.complete(completeRequest())).status, 200);
  assert.equal((await oauth.complete(completeRequest())).status, 400);
});

test('usage example rejects unsigned identity fields and a different browser', async () => {
  const oauth = createLoginExample({ origin, publicKeyPem, ticketStore: store(), createSessionToken: async () => 'b'.repeat(48) });
  const unsigned = await oauth.callback(new Request(callbackUrl, {
    method: 'POST', body: new URLSearchParams({ id: 'victim', platform: 'github' }),
  }));
  assert.equal(unsigned.status, 401);

  const wrongBrowser = await oauth.complete(new Request(origin + '/oauth/complete', {
    method: 'POST', headers: { Origin: origin, Cookie: '__Host-example_oauth_browser=' + '0'.repeat(64) + '; __Host-example_oauth_ticket=missing' },
  }));
  assert.equal(wrongBrowser.status, 400);
});
