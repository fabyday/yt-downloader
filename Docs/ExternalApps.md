# Kawaikara integration identity

The product name is `kawai-downloader`; its stable application ID is
`day.faby.kawai-downloader`, shared by `build.appId` and `kawaikara-companion.json`.
Kawaikara Providers use this ID when declaring external-app access.
The canonical launch URL is `kawai-downloader://open?url=...`.
New builds also register and accept `yt-downloader://` for existing incoming links.
Old downloader builds must be updated to receive the new canonical scheme.

The repository and npm package names remain unchanged. The existing user-data
path is preserved so preferences, cookies and queues survive the identity change.
Kawaikara does not transfer grants from `com.ytdownloader.app` or `yt-downloader`:
the new identity requires fresh registration consent. An ID is not authentication.

Changing the packaged app ID can change OS installer identity. Existing installations
may require a manual update/reinstall; legacy-to-new automatic upgrades have not
been verified on Windows or macOS.

## Connecting development apps

1. Run both development apps (for example, `pnpm start` in each checkout).
2. In downloader preferences choose **Select Kawaikara DEV folder**, then select the
   host checkout containing `package.json`. This target is remembered across restarts.
   Automatic connection is on by default. When exactly one eligible host is running,
   the app requests connection and Kawaikara displays the normal permission prompt.
3. Alternatively, choose **Connect manually** in either app. Kawaikara lists running
   compatible apps; the downloader asks for a host when several are available.
4. Approve permissions in Kawaikara. Provider permissions remain independently editable.

Both sides expose automatic discovery and manual connection controls. Disabling automatic
discovery does not disconnect an already approved binding. Existing bindings resume after
restart without a new prompt. Failed/declined initial consent and explicit disconnection
are not retried automatically; a new manual request is required.

Development connections never launch installed apps or run shell startup commands.
The downloader stores its identity, pinned host and automatic discovery preference in
`kawaikara-development-<directory-sha256>.json` under its user-data directory.
`kawaikara-connection-target.json` remembers the chosen target. Each checkout has
separate credentials; switching targets revokes the previous pairing. Existing legacy
identities are not automatically migrated, so first use requires fresh approval.
Production pairing remains separate from this transport.

Either side writes a private, immutable, binding-scoped revocation under
`<Kawaikara checkout>/tmp/development-connections/revocations/` before clearing a connection.
The other app checks this on startup even when the initiating app is no longer running.
The downloader clears the host, rotates credentials and suppresses automatic re-registration;
a manual reconnect receives new consent. Old revocations cannot invalidate new credentials.
This folder is durable protocol state, not temporary cache. No URLs or cookies are stored
in discovery, invitation or revocation records. One development client identity is bound
per product per host; disconnect it before replacing it with another environment.

## Product icon

`resources/app-icon.png` is the shared product icon used by App Info and the
Kawaikara development handshake. `resources/app-icon.svg` preserves its editable
vector source. Replace the PNG when changing the product icon (64×64 recommended).
The Main process reads and normalizes it at startup, announces a SHA-256 digest,
and sends PNG bytes only when the authenticated host requests a cache update.
Missing icons explicitly clear the host cache; unreadable/invalid assets do not
prevent connecting. Presentation changes never alter permission grants.

## Public installation descriptor

Release packaging now emits `kawaikara.manifest.json` and
`kawai-downloader-icon.png` alongside `release-manifest.json`. The release job
combines the OS/CPU artifacts, verifies a complete replacement Draft, and then
removes the previous same-version Draft. Publication remains the release owner's
explicit action.

The descriptor contains the stable app ID/name, version-pinned public icon URL,
OS/architecture variants, artifact URLs with SHA-256, installation guide, and
advisory connection protocol metadata. Kawaikara can read its HTTPS URL before
the downloader is installed. Images and documents are cached as presentation,
never permission grants. There is no Linux target until a Linux release exists.

The application still connects using the existing authenticated handshake and
permission approval. Reading this document or opening an installer does not pair
the apps. `launchScheme` describes the actual registered `kawai-downloader`
scheme; it does not authorize the reader to execute arbitrary commands.

## Version 1 and mixed local testing

The public installation descriptor, companion descriptor and connection protocol remain
version **1**. The product's existing `package.json` version remains unchanged until a
release actually requires a new product version; CI never increments it automatically.

| Kawaikara host | Downloader | Run |
| --- | --- | --- |
| Packaged | Packaged, installed | Normal OS launch / `kawai-downloader://open` handoff |
| Development | Packaged, installed | In Kawaikara: `KAWAIKARA_EXTERNAL_APP_MODE=installed pnpm start` |
| Development | Development | In Kawaikara: `KAWAIKARA_EXTERNAL_APP_MODE=development pnpm start`; here: `pnpm start` |

Installed-mode tests use the normal callback/resource-permission boundary; development
pairing records are not reused. In development mode both processes must be running.
Changing Kawaikara's mode requires restarting it. Install the packaged downloader in a
standard location recognized by Kawaikara's native adapter before testing native launch.

To test a local installer before publishing, build it here (`pnpm build:mac:arm64`,
`pnpm build:mac:x64`, `pnpm build:win:x64`, or `pnpm build:win:arm64`). Then run
Kawaikara's `scripts/serve-external-app-fixture.cjs` with `--artifact` pointing to the
resulting DMG/Setup EXE and optional `--icon` pointing to this repository's
`resources/app-icon.png`. It computes SHA-256 and serves a v1 manifest and the selected
files on an explicit loopback port. Set this variable when starting either a packaged or
development Kawaikara host:

```sh
KAWAIKARA_EXTERNAL_APP_TEST_MANIFEST='day.faby.kawai-downloader=http://127.0.0.1:8765/kawaikara.manifest.json'
```

The Provider's public manifest source is replaced for this app only for that process.
A Draft on GitHub is not a public installation source; use the local fixture while the
release is unpublished. Installation does not itself register or grant permissions.

## Rebuilding an unpublished Draft

The manual Build workflow permits the same product version while its release remains a
Draft. Published versions and standalone tags without a corresponding Draft still block
same/lower versions. Draft-only versions do not force a version bump.

After all four OS/CPU builds succeed, the release job:

1. Uploads eight installers, both manifests, and the product icon to a staging Draft.
2. Checks the complete asset set, sizes and GitHub-provided SHA-256 digests when present.
3. Rechecks that the existing same-version Draft was not published or edited meanwhile.
4. Temporarily renames the previous Draft, pins the canonical lightweight tag to the exact
   new build commit, and promotes the complete staging Draft to that version.
5. Removes the previous Draft only after promotion is confirmed. Other versions' Drafts
   and published releases remain untouched. Existing release notes are preserved.

No release is published automatically. Upload/verification failures leave the old Draft
and tag intact. A promotion failure attempts to restore them. GitHub writes are not a
transaction: if a rollback or old-Draft deletion fails, CI fails and retains recoverable
Drafts under `kawai-build-*` / `kawai-backup-*`; inspect those before manual cleanup.
Never delete the complete canonical Draft to resolve a cleanup failure. The workflow's
repository-wide concurrency group serializes its own release runs.

Implementation follows GitHub's [release API](https://docs.github.com/en/rest/releases/releases)
and [release asset API](https://docs.github.com/en/rest/releases/assets). Tests use a stateful
fake API, including failed uploads, concurrent publication and lost promotion responses;
they do not create or delete real GitHub releases.

### Package scripts for the local server

In this repository:

```sh
pnpm dev:server:build     # Build for this machine, then start the manifest server
# Or, after building:
pnpm dev:server
# A selected artifact/target/port:
pnpm dev:server --artifact /absolute/path/app.dmg --os darwin --arch arm64 --port 8765
pnpm dev:server --help
```

The default server selects the current OS/CPU's DMG or Setup EXE from `dist/`, and
serves the v1 manifest and actual product icon on `127.0.0.1:8765`. Restart it after
rebuilding so the manifest checksum matches the new bytes. It does not launch or install
the downloader. Stop it with Ctrl+C.

In the Kawaikara repository, run `pnpm dev:external:install-test` to use this default server
with the installed-app transport. For a different port, set
`KAWAIKARA_EXTERNAL_APP_TEST_MANIFEST` explicitly and use `pnpm dev:external:installed`.
For dev-to-dev connections, use `pnpm dev:external:development` in Kawaikara and
`pnpm start` here; no installation server is needed.


### Repository-local development connections (Windows, macOS and Linux)

Development discovery now lives in
`<Kawaikara checkout>/tmp/development-connections`. It is resolved
from the host build root and omitted entirely from Stable. Separate checkouts have
separate discovery roots. Old home-directory records are neither migrated nor
removed; fresh approval may be needed in the new namespace.

Run `pnpm dev:external:development` in Kawaikara, then in the downloader:

```sh
pnpm start:connected --kawaikara "/absolute/path/to/kawaikara-checkout"
```

This selects the target at launch instead of choosing it in preferences. The same
command works in PowerShell with a Windows checkout path. The script validates the host
package and passes an absolute connection directory to the child process without
shell interpolation. An explicit environment target overrides the remembered choice
for that run. Plain downloader `pnpm start` uses the remembered target or asks for a
DEV checkout; it never silently opens the installed Nightly when DEV is unavailable.
Choose **Use installed Kawaikara** explicitly to use the OS protocol handler. That
handler selects whichever installed channel owns the protocol, not a DEV checkout.
DEV target selection and connection controls are visible only in an unpackaged
development run (`app.isPackaged === false`), matching the existing developer UI.
A packaged downloader can still use an explicit
`KAWAIKARA_EXTERNAL_APP_CONNECTION_DIRECTORY` environment override for mixed-build
testing; its normal preferences do not expose these developer controls.
Both apps must already be running for DEV discovery.

For isolated fixtures, set the same absolute
`KAWAIKARA_EXTERNAL_APP_CONNECTION_DIRECTORY` on both processes before startup.

Reserved installed-app discovery roots (generic installed discovery is not wired yet):

- Windows: `%LOCALAPPDATA%\Kawaikara\connections\v1`, falling back to
  `%USERPROFILE%\AppData\Local` when LOCALAPPDATA is absent or relative.
- macOS: `~/Library/Application Support/Kawaikara/connections/v1`.
- Linux: `$XDG_STATE_HOME/kawaikara/connections/v1`, falling back to
  `~/.local/state/kawaikara/connections/v1` when XDG_STATE_HOME is absent or relative.


`dev:external:local` (alias: `dev:external:install-test`) tests distribution:
fetch the local manifest on port 8765, download/install its artifact and use installed
transport. This is separate from `dev:external:development`, which pairs running
development apps. Distribution controls remain available independently of the
connection transport when the Provider declares a manifest.

Run `pnpm test:connection` to verify target persistence, explicit installed-mode
selection, per-checkout identity isolation and offline DEV behavior.
