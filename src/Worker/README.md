# Worker

This directory owns the headless download runtime. Worker code must not depend on
Electron windows or renderer state.

The worker boundary will contain queue scheduling, yt-dlp/ffmpeg process
management, persistence, resume handling, and the Named Pipe transport. Shared
wire types belong in `src/Shared`.
