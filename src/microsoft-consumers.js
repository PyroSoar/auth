const MicrosoftBase = require('./microsoft-base');

module.exports = class extends MicrosoftBase {
  constructor(ctx) {
    super(ctx, 'microsoft-consumers', 'consumers');
  }
};
