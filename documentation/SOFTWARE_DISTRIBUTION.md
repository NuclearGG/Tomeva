# Software distribution

Users install Control Center. It contains no Admin or Librarian installer. It retrieves the latest stable `vX.Y.Z` release from `NuclearGG/Tomeva`, selects an exact component/platform filename, and verifies its SHA-256 digest and byte count. The GitHub API supplies metadata when available; the public release page and `SHA256SUMS` provide the fallback. Redirects are limited to GitHub asset hosts. Downloads are committed only after verification.

CC generates institution folders locally after downloading the requested release files. Desktop folders contain the downloaded installer, institution configuration, generated rules, and instructions. Student ZIP extraction rejects traversal, symlinks, duplicate names, unsafe Windows names, excessive file counts, and oversized output. Institution web configuration is written after extraction, including a public `tomeva-institution.json` profile. Separately downloaded Admin and Librarian apps can read that profile from the institution's HTTPS Student Portal without a Tomeva login.

`scripts/package-student.cjs` assembles the website. `scripts/collect-release.cjs` checks desktop SHA-512 against Electron update metadata. Each app has a separate feed: `latest` for CC, `admin` for Admin, and `librarian` for Librarian; Linux appends `-linux`. Preserve those names when publishing.

`packages/` versions software alongside source through Git LFS. GitHub Releases expose the same artifacts as direct downloads. Only published releases are visible to CC; drafts and missing assets cannot serve setup.

Admin and Librarian pin their feed to the institution-approved tag and recheck approval before downloading/installing. Downgrades are disabled. Builds are unsigned unless the publisher supplies signing credentials.
