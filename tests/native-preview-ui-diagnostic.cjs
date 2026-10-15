const { testBinary } = require('./binaries.cjs');
// Opt-in network diagnostic. No browser cookies; only playback status is printed.
require('ts-node/register/transpile-only');
const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
const { resolvePreview } = require('../src/Worker/PreviewResolver.ts');
process.env.UI_HARNESS_PORT = '0';
process.env.UI_HARNESS_REAL_MEDIA = '1';
const server = require('./ui-harness.cjs');
const serverReady = server.listening ? Promise.resolve() : once(server, 'listening');
const deadline = setTimeout(() => app.exit(1), 100000);
app.whenReady().then(async () => {
  let win;
  try {
    await serverReady;
    const videoId = process.argv.find(arg => arg.startsWith('--video='))?.slice(8) || 'woyNiKxoDS4';
    const source = process.argv.includes('--fixture')
      ? {ok:true,url:`http://127.0.0.1:${server.address().port}/preview-fixture.mp4`,title:'Fixture',videoId}
      : await resolvePreview(videoId, {command:testBinary('yt-dlp'),nodeRuntimePath:process.execPath});
    console.log(JSON.stringify({resolved:source.ok,error:source.ok ? undefined : source.error}));
    if (!source.ok) {app.exitCode=1;return;}
    server.previewResult=source;
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{partition:`native-ui-${Date.now()}`}});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&sourceUrl=${encodeURIComponent('https://www.youtube.com/watch?v='+videoId)}`);
    const result=await win.webContents.executeJavaScript(`(async () => {
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      let video;
      for(let i=0;i<600;i++) {
        video=document.querySelector('video.native-preview');
        if(video?.readyState>=2 && !document.querySelector('.preview-feedback')) break;
        await wait(50);
      }
      if(!video) return {video:false};
      const pausedOnLoad=video.paused;
      video.muted=true;
      document.querySelector('#playPauseButton').click();
      await wait(1500);
      const frames=video.getVideoPlaybackQuality().totalVideoFrames;
      const played=video.currentTime>0;
      document.querySelector('#playPauseButton').click();
      const input=document.querySelector('#timelineInput'),rect=input.getBoundingClientRect();
      const target=video.duration*0.8;
      const options={bubbles:true,cancelable:true,button:0,pointerId:42,clientX:rect.left+rect.width*0.8,clientY:rect.top+5};
      input.dispatchEvent(new PointerEvent('pointerdown',options));
      input.dispatchEvent(new PointerEvent('pointerup',options));
      for(let i=0;i<400;i++) {
        if(!video.seeking && Math.abs(video.currentTime-target)<0.05 && !document.querySelector('#currentTimeAnchor').classList.contains('seeking')) break;
        await wait(50);
      }
      const seekError=Math.abs(video.currentTime-target);
      const seeking=document.querySelector('#currentTimeAnchor').classList.contains('seeking');
      let resolveCalls=0;
      const originalResolve=window.ytClipper.resolvePreview;
      window.ytClipper.resolvePreview=(...args)=>{resolveCalls++;return originalResolve(...args);};
      document.querySelector('#loadButton').click();
      for(let i=0;i<200;i++) {
        const next=document.querySelector('video.native-preview');
        if(next && next!==video && !document.querySelector('.preview-feedback')) break;
        await wait(50);
      }
      return {pausedOnLoad,frames,played,seekError,seeking,resolveCalls,
        reloaded:document.querySelector('video.native-preview')!==video && !document.querySelector('.preview-feedback'),
        iframeCount:document.querySelectorAll('iframe').length};
    })()`);
    console.log(JSON.stringify(result));
    app.exitCode=result.pausedOnLoad && result.frames>0 && result.played && result.seekError<0.05 && !result.seeking && result.reloaded && result.resolveCalls===0 && result.iframeCount===0 ? 0 : 1;
  } finally {win?.destroy();server.close();clearTimeout(deadline);}
}).then(()=>app.exit(app.exitCode||0)).catch(()=>{console.error('Preview UI diagnostic failed; details suppressed');server.close();app.exit(1);});
