const { testBinary } = require('./binaries.cjs');
// Opt-in network diagnostic. Only prints playback status; never URLs/cookies/titles.
require('ts-node/register/transpile-only');
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { CookieStore } = require('../src/Worker/CookieStore.ts');
const { resolvePreview } = require('../src/Worker/PreviewResolver.ts');
const { NativePreview } = require('../src/Renderer/NativePreview.ts');
const { applyPreviewCookies } = require('../src/Main/PreviewCookies.ts');
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..');
  const store = new CookieStore(path.join(os.homedir(), 'Library/Application Support/yt-section-downloader/downloader-auth'));
  const snapshot = process.argv.includes('--cookies') ? await store.createSnapshot() : null;
  let win;
  try {
    const result = await resolvePreview(process.argv[2], {command:testBinary('yt-dlp'), nodeRuntimePath:process.execPath, cookiePath:snapshot?.path});
    if (!result.ok) { console.log(JSON.stringify(result)); app.exitCode = 1; return; }
    const partition = `native-test-${Date.now()}`;
    // Match production: native media and iframe share the imported preview jar.
    await applyPreviewCookies(session.fromPartition(partition), snapshot ? await fs.readFile(snapshot.path,'utf8') : null);
    win = new BrowserWindow({show:false, webPreferences:{partition}});
    const html = await fs.readFile(path.join(root,'src/Renderer/index.html'),'utf8');
    const policy = html.match(/content="(default-src[^"]+)"/)[1];
    await win.loadURL('data:text/html,' + encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="${policy}"><div id="player"></div>`));
    const playback = await win.webContents.executeJavaScript(`new Promise(resolve => {
      const Adapter = ${NativePreview.toString()};
      const timer = setTimeout(() => resolve({playing:false, timeout:true}), 30000);
      let adapter = new Adapter(${JSON.stringify(result)}, () => {
        adapter.video.muted = true;
        if (adapter.audio) adapter.audio.muted = true;
        adapter.playVideo();
      }, () => {}, () => {clearTimeout(timer);resolve({playing:false, code:adapter.video.error?.code, audioCode:adapter.audio?.error?.code});});
      const tick = setInterval(() => {
        if (adapter.getCurrentTime() < 0.3) return;
        clearInterval(tick); clearTimeout(timer);
        const duration = adapter.getDuration();
        adapter.seekTo(Math.min(5,duration/2));
        setTimeout(() => {
          const time = adapter.getCurrentTime();
          const drift = adapter.audio ? Math.abs(adapter.audio.currentTime-time) : 0;
          const playing = adapter.getPlayerState() === 1 && (!adapter.audio || !adapter.audio.paused);
          adapter.pauseVideo();
          const paused = !adapter.audio || adapter.audio.paused;
          adapter.destroy();
          resolve({playing,duration,seeked:time>=Math.min(5,duration/2),drift,paused});
        },1000);
      },100);
    })`);
    console.log(JSON.stringify(playback));
    app.exitCode = playback.playing && playback.seeked && playback.paused && playback.drift < 0.25 ? 0 : 1;
  } finally { win?.destroy(); await snapshot?.dispose(); }
}).then(() => app.exit(app.exitCode || 0)).catch(() => {console.error('Diagnostic failed; details suppressed');app.exit(1);});
