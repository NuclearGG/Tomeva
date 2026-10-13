'use strict';
const { pathToFileURL } = require('node:url');

function createWorkstationAccess(getWindow, getLock, entryPath) {
  const entryUrl = pathToFileURL(entryPath).href;
  function trusted(event) {
    const window = getWindow();
    return !!window && event?.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame
      && event.senderFrame?.url.split('#')[0] === entryUrl;
  }
  function assertUnlocked(event) {
    if (!trusted(event)) throw new Error('Workstation access denied.');
    const lock = getLock();
    if (!lock || lock.isLocked()) throw new Error('Workstation is locked.');
  }
  return { trusted, assertUnlocked };
}
module.exports = { createWorkstationAccess };
