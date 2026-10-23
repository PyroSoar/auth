// Huawei account login. See `huawei-honor-core.js` for the shared flow.
//
// This adapter predates the shared core and keeps the transport it shipped
// with: the consumer callback rides on the redirect_uri query string so the
// provider's `state` stays a clean opaque ticket. Changing `transport` here
// also requires revisiting the callback registered in Huawei's console.
const createAccountKitProvider = require('./huawei-honor-core');

const { HUAWEI_ID, HUAWEI_SECRET } = process.env;

module.exports = createAccountKitProvider({
  platform: 'huawei',
  callbackPath: '/huawei',
  loginHost: 'oauth-login.cloud.huawei.com',
  profileHost: 'account.cloud.huawei.com',
  clientId: HUAWEI_ID,
  clientSecret: HUAWEI_SECRET,
  transport: 'query-redirect',
});
