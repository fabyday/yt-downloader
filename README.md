# kawai-downloader

A desktop app for previewing videos, selecting precise time ranges, and downloading clips with yt-dlp on macOS and Windows.

[한국어](Docs/READMEKR.MD)

## Features

- Preview videos, set start/end points, and save multiple sections.
- Queue downloads with quality, speed, and output-format controls.
- Export original media or use editing-friendly presets and custom FFmpeg options.
- Customize shortcuts, import site-specific cookies, and switch between English, Korean, and Japanese.

## Installation

### macOS

**Use the macOS installer script** to download and install the release matching your Mac
(Apple Silicon or Intel, including detection under Rosetta):

```sh
curl --fail --location --proto '=https' --proto-redir '=https' \
  https://raw.githubusercontent.com/fabyday/yt-downloader/main/install-mac.sh -o install-mac.sh
# Review the script before running it.
bash install-mac.sh                 # Latest published stable release
bash install-mac.sh 0.1.0           # Specific published version (example)
# bash install-mac.sh --version v0.1.0
```

Choose one installation command above. Version arguments also accept published prereleases.
Draft releases cannot be installed. The script checks the ZIP's SHA-256 against the release manifest,
installs to `~/Applications/kawai-downloader.app`, and retains a backup of any existing app.
Quit the app before upgrading. Run as your normal user, **not with sudo**.
Use `--dir /Applications` if that directory is writable, or `--dir /absolute/custom/path`.

By default, installation removes **only this app's `com.apple.quarantine` attribute**.
This bypasses quarantine-triggered first-launch checks; it does not sign/notarize the app or guarantee
that it is safe. Only run it if you trust this repository and release. The checksum detects a mismatch,
not a compromised publisher. Use `--keep-quarantine` to retain normal macOS quarantine checks.
The app is not launched automatically. See [Apple's security guidance](https://support.apple.com/en-us/102445).

### Windows

Download the matching x64/ARM64 Setup or Portable EXE from [Releases](https://github.com/fabyday/yt-downloader/releases).

## Usage

1. Open the app and paste an individual video URL supported by yt-dlp.
2. Click **Load**, then set the start and end points. Use **Add section** to save multiple ranges.
3. Open **Download**, choose a folder and output settings, then add the job to the queue.
4. Use **Space** to play/pause, **A/S** to mark start/end, and **Q/W/E** to change the selection rule.
5. For videos requiring login, import cookies from **Preferences → Cookies** for the relevant site. Your account must have access to the video.

Use **Show sections** to toggle the list beside the video. Shortcuts can be changed or reset in Preferences.

Public HTTP(S) video URLs are passed to the installed yt-dlp, including its generic extractor;
the app does not maintain a fixed site allowlist. See [yt-dlp's supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).
Support is not guaranteed: site changes, login requirements, region restrictions, and codecs can prevent playback or download.
Live recording, playlists/collections, and DRM-protected media are not supported by this clip editor.
Native previews require compatible HTTPS MP4/HLS streams; cookies/custom headers or CORS may prevent preview even when downloads work.
YouTube uses the same yt-dlp stream resolver and native player as other sites; the editor does not load the YouTube iframe player.
Timeline ticks adapt to the visible time range and window width. While a seek buffers, the playhead keeps the requested position until the media seek completes.
When extraction provides a duration but no playable preview, the full-video download range remains available.
For other sites, use **Preferences → Cookies → Other sites** to import a site-scoped Netscape cookie file.
These cookies stay separate from YouTube/CHZZK and are not injected into the preview browser.
Download only content you own or have permission to save. Never share your cookies.

## Documentation

- [Build, local development, binary dependencies, and GitHub Actions](Docs/BUILD.md)
- [한국어 소개 및 사용법](Docs/READMEKR.MD)
- [Detailed usage guide (한국어)](Docs/USAGEKR.md)
- [Development notes (한국어)](Docs/DEVELOPMENT.md)
- [Kawaikara integration identity](Docs/ExternalApps.md)
