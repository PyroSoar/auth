const MicrosoftBase = require('./microsoft-base');
const { MS_tenant_Id } = process.env;

module.exports = class extends MicrosoftBase {
  static check() {
    return MS_tenant_Id && super.check();
  }

  constructor(ctx) {
    const { MS_tenant_Id } = process.env;
    super(ctx, 'microsoft-tenant', MS_tenant_Id);
  }
};
