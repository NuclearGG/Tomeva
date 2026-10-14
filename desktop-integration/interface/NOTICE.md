# Tomeva interface assets

- Manrope variable Latin, @fontsource-variable/manrope 5.3.0. SIL Open Font License; see fonts/MANROPE-LICENSE.txt.
- IBM Plex Mono Latin regular, @fontsource/ibm-plex-mono 5.3.0. SIL Open Font License; see fonts/IBM-PLEX-MONO-LICENSE.txt.
- Phosphor regular icons, @phosphor-icons/core 2.1.1. MIT; see icons/LICENSE.txt. The original SVG paths are unmodified.

These assets are vendored so the workspaces render without a network connection. Run `node scripts/prepare-interface.cjs` to copy the shared implementation into all four applications before running or packaging them.
