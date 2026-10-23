// HONOR account login. See `huawei-honor-core.js` for the shared flow.
const createAccountKitProvider = require('./huawei-honor-core');

const { HONOR_ID, HONOR_SECRET } = process.env;

module.exports = createAccountKitProvider({
  platform: 'honor',
  callbackPath: '/honor',
  loginHost: 'hnoauth-login.cloud.hihonor.com',
  profileHost: 'account-drcn.platform.hihonorcloud.com',
  clientId: HONOR_ID,
  clientSecret: HONOR_SECRET,
  // HONOR refuses a state carrying `=` or `%` (1101 / 20031), so the callback
  // is packed into base64url instead of sitting on the redirect_uri query.
  transport: 'encoded-state',
});
