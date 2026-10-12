const { testBinary } = require('./binaries.cjs');
// Opt-in public-network smoke test. Never reads browser/app cookies or prints signed URLs.
require('ts-node/register/transpile-only');
const assert=require('node:assert/strict');
const {app,BrowserWindow}=require('electron');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {resolvePreview}=require('../src/Worker/PreviewResolver.ts');
const {DownloadEngine}=require('../src/Worker/DownloadEngine.ts');
if(!process.argv.includes('--network')) { console.error('Pass --network to test public CHZZK playback.'); app.exit(1); }
const videoId=process.argv.find(arg=>arg.startsWith('--video-id='))?.split('=')[1] || '1980';
assert.match(videoId,/^\d+$/);
const videoUrl='https://chzzk.naver.com/video/'+videoId;
process.env.UI_HARNESS_PORT='0';
const server=require('./ui-harness.cjs');
const ready=server.listening?Promise.resolve():once(server,'listening');
const deadline=setTimeout(()=>app.exit(1),120000);
app.whenReady().then(async()=>{
  const root=path.resolve(__dirname,'..');
  const ytDlpPath=testBinary('yt-dlp');
  const ffmpegPath=testBinary('ffmpeg');
  const source=await resolvePreview('chzzk:'+videoId,{command:ytDlpPath,nodeRuntimePath:process.execPath});
  assert.equal(source.ok,true,'public CHZZK resolves without cookies');
  await ready;
  const win=new BrowserWindow({show:false,width:1440,height:1000});
  let scratch;
  try {
    await win.loadURL('http://127.0.0.1:'+server.address().port+'/?view=editor');
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),el=id=>document.getElementById(id);
      while(!el('urlInput'))await wait(50);
      window.mockPreviewResult=${JSON.stringify(source)};
      const calls=[];
      window.ytClipper.resolvePreview=async key=>{calls.push(key);return window.mockPreviewResult;};
      el('urlInput').value=${JSON.stringify(videoUrl)};el('loadButton').click();
      let video;
      for(let i=0;i<600;i++){
        video=document.querySelector('video.native-preview');
        if(video?.readyState>=2&&!document.querySelector('.preview-feedback'))break;
        await wait(50);
      }
      if(!video||document.querySelector('.preview-feedback'))return {ready:false,feedback:document.querySelector('.preview-feedback')?.textContent};
      const duration=video.duration,paused=video.paused;
      video.muted=true;el('playPauseButton').click();await wait(600);el('playPauseButton').click();
      const frames=video.getVideoPlaybackQuality().totalVideoFrames;
      const seek=async time=>{
        const track=el('timelineInput').getBoundingClientRect();
        const o={bubbles:true,cancelable:true,pointerId:8,button:0,clientX:track.left+track.width*time/duration,clientY:track.top+5};
        el('timelineInput').dispatchEvent(new PointerEvent('pointerdown',o));window.dispatchEvent(new PointerEvent('pointerup',o));await wait(150);
      };
      const key=letter=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:letter.toLowerCase(),code:'Key'+letter,bubbles:true,cancelable:true}));
      await seek(3);key('A');await seek(6);key('S');el('addSegmentButton').click();await wait(100);
      const range=[el('startTime').textContent,el('endTime').textContent];
      el('toggleDownloadPanelButton').click();await wait(100);el('downloadButton').click();await wait(400);
      const queue=await window.ytClipper.getDownloadQueue();
      el('toggleDownloadPanelButton').click();await wait(100);
      el('urlInput').value='https://chzzk.naver.com/live/abcd';el('loadButton').click();
      const liveNotice=el('setupStatusLabel').textContent;
      return {ready:true,duration,paused,frames,range,calls,queueUrl:queue[0]?.payload.url,liveNotice};
    })()`);
    console.log(JSON.stringify(result));
    assert.equal(result.ready,true);assert.equal(result.paused,true);assert.ok(result.duration>90);assert.ok(result.frames>0);
    assert.deepEqual(result.calls,['chzzk:'+videoId]);
    assert.deepEqual(result.range,['00:03.000','00:06.000']);
    assert.equal(result.queueUrl,videoUrl);
    assert.match(result.liveNotice,/Live recording is not supported/);
    if(process.argv.includes('--download')){
      scratch=await fs.mkdtemp(path.join(os.tmpdir(),'kawai-chzzk-network-'));
      const engine=new DownloadEngine({cacheDirectory:path.join(scratch,'cache'),ytDlpPath,ffmpegPath,nodeRuntimePath:process.execPath});
      const download=await engine.execute({url:videoUrl,locale:'en',
        segments:[{start:3,end:6}],downloadQuality:'480',encodingPreset:'h264-mp4',
        outputDir:scratch,basename:'clip',resumeKey:'chzzk-test'},()=>{});
      assert.equal(download.ok,true,'CHZZK section download');
      const probe=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_streams','-show_format','-of','json',download.outputPath],{encoding:'utf8'}));
      const streams=probe.streams.map(s=>s.codec_type);
      assert.ok(streams.includes('video')&&streams.includes('audio'));
      assert.ok(Math.abs(Number(probe.format.duration)-3)<0.2);
      console.log(JSON.stringify({download:true,streams,duration:probe.format.duration}));
    }
  }finally{win.destroy();if(scratch)await fs.rm(scratch,{recursive:true,force:true});}
  server.close();clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error instanceof assert.AssertionError?error.message:'CHZZK network test failed (details suppressed)');server.close();app.exit(1);});
