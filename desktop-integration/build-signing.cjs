'use strict';
function configureSigning(build) {
  const publisher = process.env.TOMEVA_WINDOWS_PUBLISHER?.trim();
  const release = process.env.TOMEVA_REQUIRE_SIGNING === '1';
  if (release) {
    if (!require('./release-keys.cjs').length) throw new Error('Configure an existing publisher release key before a release build.');
    if (!publisher || !(process.env.CSC_LINK || process.env.WIN_CSC_LINK)) throw new Error('A release build requires the Windows publisher name and an existing code-signing certificate.');
  }
  return { ...build, win: { ...build.win, forceCodeSigning: release,
    ...(publisher ? { publisherName: publisher, verifyUpdateCodeSignature: true } : {}) } };
}
module.exports = { configureSigning };
