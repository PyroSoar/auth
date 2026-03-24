const MicrosoftBase = require('./microsoft-base');

module.exports = class extends MicrosoftBase {
  constructor(ctx) {
    super(ctx, 'microsoft-common', 'common');
  }
};