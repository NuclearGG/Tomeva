const { app } = require('electron');
module.exports = require(app?.isPackaged ? './integration/oauth-flow.cjs' : '../desktop-integration/oauth-flow.cjs');
