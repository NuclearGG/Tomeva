const { build, Platform, Arch } = require('electron-builder');
const path = require('node:path');
build({
  targets: Platform.WINDOWS.createTarget('dir', Arch.x64),
  config: { electronDist: path.resolve(__dirname, '../node_modules/electron/dist') },
}).catch(error => { console.error(error); process.exitCode = 1; });
