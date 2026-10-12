const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
process.env.UI_HARNESS_PORT = '0';
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server,'listening');
const deadline = setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
  await ready;
  const win = new BrowserWindow({show:false,width:1440,height:1000});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor`);
  await win.webContents.executeJavaScript(`(async()=>{
    while(!document.querySelector('#toggleDownloadPanelButton')) await new Promise(r=>setTimeout(r,50));
    document.querySelector('#toggleDownloadPanelButton').click();
    window.cookieListeners.forEach(fn=>fn({configured:true,count:3}));
  })()`);
  for(const width of [1440,1000]) {
    win.setSize(width,1000);
    await new Promise(r=>setTimeout(r,600));
    const state = await win.webContents.executeJavaScript(`({
      cookiesInPanel:!!document.querySelector('.status-panel #cookieStatus'),
      toolbarCookie:!!document.querySelector('#openPreferenceOverlayButton .toolbar-cookie-badge'),
      labels:[...document.querySelectorAll('.status-panel .dependency-label')].map(el=>({text:el.textContent,overflow:el.scrollWidth>el.clientWidth+1,ellipsis:getComputedStyle(el).textOverflow==='ellipsis',height:el.getBoundingClientRect().height}))
    })`);
    assert.equal(state.cookiesInPanel,true);assert.equal(state.toolbarCookie,false);
    assert.deepEqual(state.labels.map(item=>item.text),['yt-dlp: 2026.08.19','ffmpeg: 7.1-tessus','Cookies saved']);
    for(const label of state.labels){assert.equal(label.overflow,false);assert.equal(label.ellipsis,false);assert.ok(label.height>0);}
  }
  win.destroy();server.close();clearTimeout(deadline);console.log('Dependency status: full versions, cookie relocation, 1000/1440px layout passed');app.exit(0);
}).catch(error=>{console.error(error);server.close();app.exit(1);});
