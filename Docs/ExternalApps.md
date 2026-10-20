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
2. Automatic connection is on by default. When exactly one eligible host is running,
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
`kawaikara-development-connection.json` under its user-data directory. Production pairing
remains separate from this transport.

Either side writes a private, immutable, binding-scoped revocation under
`~/.kawaikara/development-connections/revocations/` before clearing a connection.
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
