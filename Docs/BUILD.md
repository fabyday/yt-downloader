# Building kawai-downloader

[README](../README.md) · [한국어 사용법](READMEKR.MD) · [Development notes](DEVELOPMENT.md)

Run commands from the repository root. The paths below describe the current scripts, not an automatic setup performed by `pnpm install`.

## Requirements

- Node.js 22.12 or newer; CI uses Node.js 24.
- pnpm 10.33.0, as pinned in [package.json](../package.json).
- Build macOS packages on macOS and Windows packages on Windows.

```sh
pnpm install --frozen-lockfile
```

KawaiUI comes from a pinned GitHub commit in the lockfile. A sibling KawaiUi checkout is not required.

## Where binaries come from

| Context | Binary source |
| --- | --- |
| Local `pnpm start` / `pnpm dev` | Automatically prepares and uses `.cache/build-binaries/<platform>-<arch>/`; explicit environment overrides take precedence |
| Local packaging and GitHub Actions | Downloads pinned per-platform/per-CPU assets into `.cache/build-binaries/<platform>-<arch>/` |
| Installed app | Packaged binaries under `resources/binaries/<platform>-<arch>/` |
| Runtime yt-dlp update | Verified updates in the app's user-data `binaries/yt-dlp/` directory |

There are no pre-downloaded executables tracked in the working tree. Development, tests and packaging
share the same binary preparation and target-specific cache.
[prepare-binaries.cjs](../scripts/prepare-binaries.cjs) reads fixed URLs and SHA-256 hashes from
[binary-sources.json](../scripts/binary-sources.json), verifies downloads and executable architecture,
and prepares the selected target. Downloaded archives/assets are cached separately under
`.cache/build-binaries/downloads/`.

[build.cjs](../scripts/build.cjs) includes the prepared binaries, supplier notices, and `sources.json`
in the app. The first preparation requires network access; subsequent local builds reuse verified
downloads. The workflow currently caches the pnpm store, **not** this binary cache, so fresh CI
runners download the assets.

### Cache and packaged resources

- **`.cache/build-binaries/`:** generated and Git-ignored. It can be removed when no preparation,
  build, test or development process is using it; the next start/build/test prepares it again.
- **An installed app's `resources/binaries/`:** required runtime files. Do not remove these from
  a distributable app.
- **`src/Worker/yt-dlp-plugins/`:** application source, not a disposable binary cache. Keep it.

Prepared binaries are checked against local receipts, source-manifest fingerprints and executable
architecture before reuse. Matching executables are not rewritten while running. Missing/corrupt
files are repaired from verified cached downloads, or downloaded again when necessary. A failed
download does not overwrite a working executable.

### Prepare binaries or supply your own

Prepare the current OS/Node CPU target:

```sh
pnpm binaries:prepare
```

`pnpm start` does this automatically before bundling and discovers this cache without environment
variables. Tests and diagnostics using `tests/binaries.cjs` also prepare/reuse it automatically.
Running Electron directly skips the preparation step: run the command above first.

To override the managed binaries, set explicit paths. For example, on Apple Silicon macOS:

```sh
YT_DLP_PATH="$PWD/.cache/build-binaries/darwin-arm64/yt-dlp" \
FFMPEG_PATH="$PWD/.cache/build-binaries/darwin-arm64/ffmpeg" \
pnpm start
```

Use `darwin-x64` for Intel. On Windows x64, in PowerShell:

```powershell
$env:YT_DLP_PATH = (Resolve-Path ".cache/build-binaries/win32-x64/yt-dlp.exe").Path
$env:FFMPEG_PATH = (Resolve-Path ".cache/build-binaries/win32-x64/ffmpeg.exe").Path
pnpm start
```

Use `win32-arm64` for Windows ARM64. If Node runs under emulation, prepare the intended target
explicitly, for example `pnpm binaries:prepare --platform darwin --arch arm64`.
The runtime selects the target matching Electron's OS/CPU. Use a native Node installation matching
your Electron target for development. The environment overrides apply to tests as well.

### Runtime updates are separate

App-owned workers check for a newer official stable yt-dlp at startup and install verified updates
in user data without changing the app bundle. A working cached/bundled binary remains usable while
checking; failures fall back to a working version. View the status in Preferences → App Info.
The **Check yt-dlp updates** button retries without restarting the app. Concurrent checks share one
operation; active downloads keep their selected binary, and later jobs use the updated version.
Missing/outdated binaries are reported separately from a failed check with a usable fallback.

Setting `YT_DLP_PATH` disables the app's yt-dlp updater for that override. Externally owned workers
manage their own binaries; the manual update button is disabled in those cases.
FFmpeg is not automatically updated at app startup. The **Automatic app release checks** setting
controls the app's GitHub release lookup, not the independent yt-dlp updater.
The app passes Electron's embedded Node runtime to yt-dlp; Python is not required to run the
distributed macOS/Windows yt-dlp executables.

## Development commands

```sh
pnpm start          # Prepare binaries, bundle sources and launch Electron (same as pnpm dev)
pnpm watch          # Rebuild sources as they change; does not launch Electron
pnpm typecheck
pnpm bundle:prod    # Compile production bundles, without installers or binary preparation
```

Run the app as your normal logged-in user, not with `sudo`.

## Package the app

| Target | Command | Output |
| --- | --- | --- |
| macOS Apple Silicon | `pnpm build:mac:arm64` | `dist/darwin-arm64/` |
| macOS Intel | `pnpm build:mac:x64` | `dist/darwin-x64/` |
| Windows x64 | `pnpm build:win:x64` | `dist/win32-x64/` |
| Windows ARM64 | `pnpm build:win:arm64` | `dist/win32-arm64/` |

```sh
pnpm build                             # Current OS/Node CPU installers
pnpm build:dir                         # .app / unpacked app, without installers
pnpm build:dir --arch arm64             # Explicit CPU
pnpm build --platform darwin --arch x64
pnpm test:build
pnpm release:manifest --dir dist/darwin-arm64
```

`build:win` is an x64 alias; `build:mac` follows the current Node CPU.
macOS produces DMG/ZIP packages; Windows produces NSIS Setup and Portable EXE packages.
Outputs and artifact names are separated by platform and CPU.

The build prepares/verifies binaries, checks types, bundles production code, packages the app,
then validates packaged resources. On matching host/target CPUs it also runs the packaged binaries'
version commands. Other-CPU binaries are architecture-checked, not executed locally.

The CHZZK compatibility plugin is copied by the worker bundle and unpacked from ASAR via
`build.asarUnpack`; Python inside yt-dlp cannot read Electron's ASAR archive. The packaging check
requires the unpacked plugin. Do not remove it when trimming resources.

To update bundled dependencies, change URLs and SHA-256 values together in
`scripts/binary-sources.json` and verify all four targets. Runtime yt-dlp updates do not change this
pinned packaging manifest. Preserve supplier license notices and review distribution requirements
for FFmpeg and its enabled codecs before publishing.

## GitHub Actions

[The Build workflow](../.github/workflows/build.yml) runs **only manually**:
**Actions → Build → Run workflow**, select a branch, then run. Pushes and pull requests do not
start a build. Each run builds all four targets below.

It installs pnpm before setting up Node.js and its pnpm cache, installs the frozen lockfile,
runs build-configuration tests, then invokes the **same** `pnpm build` script used locally.

| Platform / CPU | Configured runner |
| --- | --- |
| Windows x64 | `windows-latest` |
| Windows ARM64 | `windows-11-arm` |
| macOS Intel | `macos-15-intel` |
| macOS Apple Silicon | `macos-15` |

Download `kawai-downloader-<platform>-<arch>` from the completed run's Artifacts.
Installers and `release-manifest.json` are retained for 14 days.

The workflow does not automatically sign/notarize apps or publish GitHub Releases.
These are unsigned test artifacts; OS trust warnings may appear. The manifest's release URLs are
intended for later publication under matching filenames, not links to Actions artifacts.
