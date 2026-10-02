# Software distribution

Users install Control Center. It retrieves the latest stable `vX.Y.Z` release from `NuclearGG/Tomeva`, selects an exact component/platform filename, and verifies GitHub's SHA-256 digest and byte count. Redirects are limited to GitHub asset hosts. Downloads are committed only after verification.

CC generates institution folders locally. Desktop folders contain the installer, institution configuration, generated rules, and instructions. Student ZIP extraction rejects traversal, symlinks, duplicate names, unsafe Windows names, excessive file counts, and oversized output. Institution web configuration is written after extraction.

`scripts/package-student.cjs` assembles the website. `scripts/collect-release.cjs` checks desktop SHA-512 against Electron update metadata. Each app has a separate feed: `latest` for CC, `admin` for Admin, and `librarian` for Librarian; Linux appends `-linux`. Preserve those names when publishing.

`packages/` versions software alongside source through Git LFS. GitHub Releases expose the same artifacts as direct downloads. Only published releases are visible to CC; drafts and missing assets cannot serve setup.

Admin and Librarian pin their feed to the institution-approved tag and recheck approval before downloading/installing. Downgrades are disabled. Builds are unsigned unless the publisher supplies signing credentials.
