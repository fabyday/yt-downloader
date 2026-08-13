# Releasing YT Section Downloader

Kawaikara installs the external downloader from the latest GitHub Release. Each
release must contain `release-manifest.json` and every artifact referenced by it.

1. Set the release version in `package.json`.
2. Build the macOS and/or Windows artifacts.
3. Put all release artifacts in `dist` and run `pnpm release:manifest`.
4. Publish every referenced artifact and `dist/release-manifest.json` together in
   the latest release at `fabyday/yt-downloader`.

Kawaikara requires HTTPS artifact URLs and a SHA-256 value for every artifact.
macOS installation accepts DMG or ZIP files and checks that the installed bundle
identifier is `com.ytdownloader.app` before removing quarantine from the staged
application.
