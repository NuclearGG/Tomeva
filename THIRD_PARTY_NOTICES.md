# Third-party notices and inventories

Tomeva source is licensed under the root [MIT license](LICENSE). Desktop package metadata uses the same project license. Dependencies and bundled assets retain their own licenses; Tomeva's license does not replace those notices.

| Bundled asset | License source |
| --- | --- |
| Manrope | SIL Open Font License 1.1, `desktop-integration/interface/fonts/MANROPE-LICENSE.txt` |
| IBM Plex Mono | SIL Open Font License 1.1, `desktop-integration/interface/fonts/IBM-PLEX-MONO-LICENSE.txt` |
| Phosphor Icons | MIT, `desktop-integration/interface/icons/LICENSE.txt` |
| Electron / Chromium | Preserve the Electron and Chromium license/notice files distributed with the runtime. |

Run `npm run sbom` to generate CycloneDX JSON and per-package license inventories for Control Center, Admin, and Librarian/the shared Firebase web SDK. Files are under `release-artifacts/sbom/`; provenance records the source commit, source dirty state, hashes and component counts. Development/build dependencies are included deliberately so bundled SDK inputs are not omitted. The web clients obtain their Firebase SDK from the Librarian lockfile even when that SDK is absent from a desktop app's own production dependency tree.

For a release, regenerate on clean tagged source, review missing/ambiguous package license metadata, and include the `--release` SBOM ZIP with the release's checksummed assets. A generated inventory reports package metadata; it does not establish that every upstream notice or distribution obligation has been reviewed. Keep this review as a release gate.

Version 1.0.10 release inventories cover both the modern lockfiles and the actual legacy staging lockfiles, including Electron 22 and better-sqlite3 11. Input lockfile hashes are recorded in provenance. The archive also includes Tomeva's MIT license and these notices.

The npm-generated modern inventory omits license metadata for the development dependencies `exit@0.1.2` and `limiter@1.1.5`. Their installed `LICENSE-MIT` and `LICENSE.txt` files respectively were reviewed: both contain the MIT permission/license text. These packages use the older `licenses` metadata property; the unmodified generated inventory is retained rather than silently rewriting its output.
