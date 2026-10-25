# Developer security note: legacy distribution suspension

Decision date: 25 October 2026. Audience: developers and release maintainers. Public-facing copy lives in `web/legacy-paused.html` and deliberately avoids vulnerability identifiers and runtime terminology.

## Specific Node.js bug

**CVE-2026-111497 — Brotli decoder out-of-bounds write**, disclosed in the [Node.js 21 October 2026 security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases#nodejs-brotli-decoder-out-of-bounds-write-permits-remote-code-execution-cve-2026-111497---high). Invalid block-switch handling can let attacker-controlled compressed input corrupt process memory. Possible consequences include crashes, memory disclosure and remote code execution. This is an upstream component vulnerability; it is not evidence that a Tomeva installation has been compromised.

The 23 October Tomeva artifact audit found the three v1.0.10 Windows legacy apps shipping Electron 22.3.27 / Node 16.17.1 / Brotli 1.0.9. Exact linked-source inspection and packaged runtime probes identified the old decoder and a reachable automatic compressed-response path through legacy network helpers. The audit did not attempt memory corruption or arbitrary code execution. The supported Node bulletin's version ranges do not, by themselves, certify EOL Node 16: the legacy assessment comes from the component/source evidence. The upstream [Brotli 1.2.1 release](https://github.com/google/brotli/releases/tag/v1.2.1) explicitly records this CVE.

For standalone development Node, upstream fix releases are 22.23.4, 24.22.1 and 26.12.1. Recheck the current supported security release before building. Updating a developer's installed Node does not replace an Electron application's embedded runtime. Do not manually swap DLLs or run npm audit fix --force as a remediation shortcut.

The audit found the modern builds' linked Chromium Brotli decoder already had the relevant block-switch validation, despite the embedded Node version string. Do not describe modern Tomeva as affected by this specific confirmed legacy Brotli finding. This is not an all-clear for modern runtimes: the audit separately reproduced the Undici encoding-chain process termination (CVE-2026-109869 / GHSA-xjj6-f33q-929c) and identified certificate-trust mitigation gaps. Modern downloads remain available by product decision, not a claim that every runtime advisory is resolved.

Local audit evidence: `documentation/NODE_SECURITY_AUDIT_2026-10-23.md` and its JSON companion, when present. Those pre-existing working-tree documents were not modified by this suspension. Sources were rechecked against official Node/Brotli publications on 25 October.

## Distribution controls

- Legacy release assets (installers, matching blockmaps and legacy updater YAML feeds) are removed from v1.0.5–v1.0.10. Release records, modern installers, modern feeds, Student Portal archives and original release checksum evidence are retained.
- Legacy binaries/blockmaps and feeds are removed from the current repository tree. The local package checksum list is filtered to retained files; retained binary contents and digest values do not change.
- The website's legacy card goes to a dedicated notice. Release discovery can update modern assets only. Cached old card markup is neutralized when the updated script loads; changing resource version query strings encourages refresh.
- Publication refuses a package directory containing legacy distributions. The legacy collector fails before copying any file. Local legacy source/build investigation remains possible.
- The website changes require a separately authorized Pages deployment. The external asset removals are authorized directly in the user's request.

These actions cannot revoke installers already downloaded or mirrored. Public Git history and historical source archives can still contain tracked legacy binaries; no force-push/history rewrite was performed. Existing caches/forks may retain copies. Do not claim complete eradication from the internet. Historical SHA256SUMS entries are verification records, not working download actions; published checksum files are preserved.

## Reinstatement gate

Do not re-enable the website card, release collector or publisher until a safer replacement has passed dependency/runtime review, circulation and backup regressions, actual packaged binary inspection, and Windows 7/8.1 compatibility validation. The native preview is not a production replacement or a release commitment. No return date is announced.
