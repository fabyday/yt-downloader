// Explicit network smoke test; isolated session, no secret output.
require('ts-node/register/transpile-only');
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CookieStore } = require('../src/Worker/CookieStore.ts');
const { applyPreviewCookies } = require('../src/Main/PreviewCookies.ts');
const videoId = process.argv[2];
if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('Supply video ID');
app.whenReady().then(async () => {
  const partition = `preview-test-${Date.now()}`;
  const target = session.fromPartition(partition);
  target.webRequest.onCompleted({urls:['https://*.googlevideo.com/*','https://www.youtube.com/*']}, details => {
    if (details.statusCode >= 400) console.log(JSON.stringify({networkStatus:details.statusCode, host:new URL(details.url).hostname.replace(/^[^.]+\.googlevideo/, 'media.googlevideo')}));
  });
  const store = new CookieStore(path.join(os.homedir(), 'Library/Application Support/yt-section-downloader/downloader-auth'));
  const snapshot = await store.createSnapshot();
  let win, server;
  try {
    const count = await applyPreviewCookies(target, snapshot ? await fs.readFile(snapshot.path, 'utf8') : null);
    console.log(JSON.stringify({ previewCookieCount: count }));
    server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><div id="player"></div><script>
      window.result = {ready:false, error:null, duration:0, playing:false};
      window.onYouTubeIframeAPIReady = () => { window.player = new YT.Player('player', {videoId:${JSON.stringify(videoId)}, playerVars:{origin:location.origin}, events:{
        onReady: () => {result.ready=true;player.mute();player.playVideo();}, onError: e => {result.error=e.data;},
        onStateChange: e => {if(e.data===1) result.playing=true;}
      }}); setInterval(() => result.duration=player.getDuration?.() || 0, 200); };
      </script><script src="https://www.youtube.com/iframe_api"></script>`); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    win = new BrowserWindow({show:true, width:800, height:600, webPreferences:{partition, contextIsolation:true, nodeIntegration:false}});
    let loadTimer;
    try {
      await Promise.race([win.loadURL(`http://127.0.0.1:${server.address().port}`),
        new Promise((_, reject) => {loadTimer = setTimeout(() => reject(new Error('Load timeout')), 25000);})]);
    } finally { clearTimeout(loadTimer); }
    const deadline = Date.now() + 45000;
    let result;
    while (Date.now() < deadline) {
      result = await win.webContents.executeJavaScript('window.result');
      if (result.error || (result.playing && result.duration > 0)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(JSON.stringify(result));
    process.exitCode = result.playing && result.duration > 0 ? 0 : 1;
  } finally { win?.destroy(); server?.close(); await snapshot?.dispose(); app.exit(process.exitCode || 0); }
}).catch(() => { console.error('Preview diagnostic failed; details suppressed'); app.exit(1); });
