# kawai-downloader

A desktop app for previewing YouTube and CHZZK videos, selecting precise time ranges, and downloading clips on macOS and Windows.

[한국어](Docs/READMEKR.MD)

## Features

- Preview videos, set start/end points, and save multiple sections.
- Queue downloads with quality, speed, and output-format controls.
- Export original media or use editing-friendly presets and custom FFmpeg options.
- Customize shortcuts, import site-specific cookies, and switch between English, Korean, and Japanese.

## Usage

1. Open the app and paste a YouTube video or CHZZK replay/upload URL.
2. Click **Load**, then set the start and end points. Use **Add section** to save multiple ranges.
3. Open **Download**, choose a folder and output settings, then add the job to the queue.
4. Use **Space** to play/pause, **A/S** to mark start/end, and **Q/W/E** to change the selection rule.
5. For videos requiring login, import cookies from **Preferences → Cookies** for the relevant site. Your account must have access to the video.

Use **Show sections** to toggle the list beside the video. Shortcuts can be changed or reset in Preferences.

CHZZK support currently covers `/video/` URLs, not live recording or clip-only URLs.
Download only content you own or have permission to save. Never share your cookies.

## Documentation

- [Build, local development, binary dependencies, and GitHub Actions](Docs/BUILD.md)
- [한국어 소개 및 사용법](Docs/READMEKR.MD)
- [Detailed usage guide (한국어)](Docs/USAGEKR.md)
- [Development notes (한국어)](Docs/DEVELOPMENT.md)
