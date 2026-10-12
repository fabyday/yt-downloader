const { testBinary } = require('./binaries.cjs');
// Offline HLS playback + site-scoped cookie UI. Uses generated media and fake credentials only.
const assert=require('node:assert/strict');
const {app,BrowserWindow,session}=require('electron');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
process.env.UI_HARNESS_PORT='0';
const server=require('./ui-harness.cjs');
const ready=server.listening?Promise.resolve():once(server,'listening');
const deadline=setTimeout(()=>app.exit(1),45000);
app.whenReady().then(async()=>{
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'kawai-hls-fixture-'));
  const ffmpeg=testBinary('ffmpeg');
  let win;
  try {
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
      '-t','8','-c:v','libx264','-preset','ultrafast','-g','30','-pix_fmt','yuv420p','-c:a','aac','-f','hls','-hls_time','1','-hls_list_size','0',
      '-hls_segment_filename',path.join(scratch,'segment%d.ts'),path.join(scratch,'fixture.m3u8')]);
    const partition='chzzk-hls-test-'+Date.now();
    const requested=[];
    await session.fromPartition(partition).protocol.handle('https',async request=>{
      const url=new URL(request.url);
      if(url.hostname!=='fixture.pstatic.net'||!/^\/(fixture\.m3u8|segment\d+\.ts)$/.test(url.pathname))return new Response('',{status:404});
      requested.push(url.pathname);
      return new Response(await fs.readFile(path.join(scratch,path.basename(url.pathname))),{headers:{
        'Content-Type':url.pathname.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t',
        'Access-Control-Allow-Origin':'*'
      }});
    });
    await ready;
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{partition}});
    await win.loadURL('http://127.0.0.1:'+server.address().port+'/?view=editor');
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),el=id=>document.getElementById(id);
      while(!el('urlInput'))await wait(50);
      window.mockPreviewResult={ok:true,url:'https://fixture.pstatic.net/fixture.m3u8',transport:'hls',title:'CHZZK fixture',videoId:'chzzk:1980'};
      el('urlInput').value='https://chzzk.naver.com/video/1980';el('loadButton').click();
      let video;
      for(let i=0;i<500;i++){
        video=document.querySelector('video.native-preview');
        if(video?.readyState>=2&&!document.querySelector('.preview-feedback'))break;
        await wait(50);
      }
      if(!video||document.querySelector('.preview-feedback'))return {ready:false,feedback:document.querySelector('.preview-feedback')?.textContent};
      video.muted=true;el('playPauseButton').click();await wait(400);el('playPauseButton').click();
      const frames=video.getVideoPlaybackQuality().totalVideoFrames,duration=video.duration;
      let statuses={youtube:{configured:true,count:1},chzzk:{configured:false,count:0,loginCookiesPresent:false}};
      const calls=[];
      const status=()=>({configured:Object.values(statuses).some(s=>s.configured),count:statuses.youtube.count+statuses.chzzk.count,sites:structuredClone(statuses)});
      window.ytClipper.getCookieStatus=async()=>status();
      window.ytClipper.importBrowserCookies=async options=>{calls.push(['extract',options.site]);statuses[options.site]={configured:true,count:2,loginCookiesPresent:true};return status();};
      window.ytClipper.importCookies=async site=>{calls.push(['file',site]);return status();};
      window.ytClipper.clearCookies=async site=>{calls.push(['clear',site]);statuses[site]={configured:false,count:0,loginCookiesPresent:false};return status();};
      el('openPreferenceOverlayButton').click();await wait(150);
      [...document.querySelectorAll('[role=tab]')].find(e=>e.textContent==='Cookies').click();await wait(150);
      el('cookieSiteSelect').click();await wait(50);
      [...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes('CHZZK')).click();await wait(100);
      const actions=()=>document.querySelectorAll('.cookie-actions button');
      actions()[0].click();await wait(200);
      const loginMessage=document.querySelector('.cookie-application-status').textContent;
      actions()[1].click();await wait(100);actions()[2].click();await wait(100);
      const preserved=statuses.youtube.configured;
      if(${process.argv.includes('--screenshot')}) {actions()[0].click();await wait(100);}
      return {ready:true,frames,duration,calls,loginMessage,preserved};
    })()`);
    console.log(result);
    assert.equal(result.ready,true);assert.ok(result.frames>0);assert.ok(result.duration>=8);
    assert.deepEqual(result.calls.slice(0,3),[['extract','chzzk'],['file','chzzk'],['clear','chzzk']]);
    assert.equal(result.preserved,true);assert.match(result.loginMessage,/does not verify/);
    assert.ok(requested.includes('/fixture.m3u8')&&requested.some(p=>p.endsWith('.ts')));
    if(process.argv.includes('--screenshot'))await fs.writeFile('/tmp/kawai-chzzk-cookies.png',(await win.webContents.capturePage()).toPNG());
  }finally{win?.destroy();await fs.rm(scratch,{recursive:true,force:true});}
  server.close();clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error);server.close();app.exit(1);});
