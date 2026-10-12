const { testBinary } = require('./binaries.cjs');
// Explicit live-video diagnostic. Never prints signed URLs, cookies or video titles.
require('ts-node/register/transpile-only');
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { CookieStore } = require('../src/Worker/CookieStore.ts');
const { resolvePreview } = require('../src/Worker/PreviewResolver.ts');
const { applyPreviewCookies } = require('../src/Main/PreviewCookies.ts');
process.env.UI_HARNESS_PORT = '0';
const server = require('./ui-harness.cjs');
const serverReady = server.listening ? Promise.resolve() : once(server, 'listening');
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..');
  const store = new CookieStore(path.join(os.homedir(), 'Library/Application Support/yt-section-downloader/downloader-auth'));
  const fixture = process.argv.includes('--fixture');
  const snapshot = fixture ? null : await store.createSnapshot();
  let win;
  try {
    const started = Date.now();
    await serverReady;
    const source = fixture ? {ok:true,url:`http://127.0.0.1:${server.address().port}/preview-fixture.mp4`,title:'Fixture',videoId:'K7bx0zyTYFM'}
      : await resolvePreview('K7bx0zyTYFM', {command:testBinary('yt-dlp'),nodeRuntimePath:process.execPath,cookiePath:snapshot?.path});
    console.log(JSON.stringify({resolveMs:Date.now()-started, ok:source.ok, error:source.ok ? undefined : source.error}));
    if (!source.ok) {app.exitCode = 1;return;}
    const partition = `preview-ui-${Date.now()}`;
    await applyPreviewCookies(session.fromPartition(partition), snapshot ? await fs.readFile(snapshot.path,'utf8') : null);
    win = new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{partition}});
    await serverReady;
    await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&sourceUrl=https://www.youtube.com/watch?v=K7bx0zyTYFM`);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
      while (!window.mockPlayer) await wait(50);
      window.mockPreviewResult = ${JSON.stringify(source)};
      let resolveCalls = 0;
      const originalResolve = window.ytClipper.resolvePreview;
      window.ytClipper.resolvePreview = (...args) => {resolveCalls++;return originalResolve(...args);};
      const started = performance.now();
      window.mockPlayer.options.events.onError({data:100});
      let video;
      for (let i=0;i<600;i++) {
        video = document.querySelector('video.native-preview');
        if (video?.readyState>=2 && !document.querySelector('.preview-feedback')) break;
        await wait(50);
      }
      if (!video) return {video:false};
      const rect = video.getBoundingClientRect();
      const pausedOnLoad = video.paused;
      const readyMs = performance.now()-started;
      video.muted = true;
      document.querySelector('#playPauseButton').click();
      await wait(1500);
      const frames = video.getVideoPlaybackQuality().totalVideoFrames;
      const result = {readyMs,pausedOnLoad,visible:rect.width>0&&rect.height>0,width:rect.width,height:rect.height,
        videoWidth:video.videoWidth,videoHeight:video.videoHeight,frames,currentTime:video.currentTime,feedback:!!document.querySelector('.preview-feedback')};
      document.querySelector('#playPauseButton').click();
      document.querySelector('#loadButton').click();
      for(let i=0;i<100;i++) {
        const reloaded=document.querySelector('video.native-preview');
        if(reloaded && reloaded!==video && !document.querySelector('.preview-feedback')) break;
        await wait(50);
      }
      result.resolveCalls=resolveCalls;
      result.reloaded=!!document.querySelector('video.native-preview') && !document.querySelector('.preview-feedback');
      return result;
    })()`);
    console.log(JSON.stringify(result));
    app.exitCode = result.visible && result.frames>0 && result.pausedOnLoad && !result.feedback && result.reloaded && result.resolveCalls===1 ? 0 : 1;
  } finally {win?.destroy();await snapshot?.dispose();server.close();}
}).then(()=>app.exit(app.exitCode||0)).catch(()=>{console.error('Preview UI diagnostic failed; details suppressed');server.close();app.exit(1);});
