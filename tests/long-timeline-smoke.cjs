const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
process.env.UI_HARNESS_PORT = '0';
process.env.UI_HARNESS_DURATION = '360000'; // 100 hours, including three-digit hour labels.
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server, 'listening');
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  await ready;
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000 });
  const js = code => win.webContents.executeJavaScript(code);
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&sourceUrl=https://www.youtube.com/watch?v=woyNiKxoDS4`);
  await js(`new Promise(resolve => {const timer = setInterval(() => {
    if (window.mockPlayer && !document.querySelector('#timelineInput').disabled && !document.querySelector('.preview-feedback')) {
      clearInterval(timer); resolve();
    }
  }, 20);})`);
  assert.equal(await js(`!!document.querySelector('video.native-preview') && !document.querySelector('iframe') && !document.querySelector('script[src*="iframe_api"]')`), true);
  await js(`window.testSeek = (ratio, surfaceId = 'timelineRuler') => {
    const element = document.getElementById(surfaceId), rect = element.getBoundingClientRect();
    const options = {bubbles:true,cancelable:true,button:0,pointerId:42,clientX:rect.left+rect.width*ratio,clientY:rect.top+5};
    element.dispatchEvent(new PointerEvent('pointerdown', options));
    element.dispatchEvent(new PointerEvent('pointerup', options));
  }; void 0;`);
  // Buffering beyond the old 1.2-second timeout must preserve the requested position.
  await js(`window.mockSeekDelayMs=2000;window.testSeek(0.8);void 0;`);
  await new Promise(resolve => setTimeout(resolve, 1400));
  assert.equal(await js(`document.querySelector('#currentTime').textContent`), '80:00:00.000');
  assert.equal(await js(`document.querySelector('#currentTimeAnchor').classList.contains('seeking')`), true);
  // A second seek wins even while the first request is still buffering.
  await js(`window.testSeek(0.9, 'timelineRuler');void 0;`);
  await new Promise(resolve => setTimeout(resolve, 2800));
  assert.equal(await js(`document.querySelector('#currentTime').textContent`), '90:00:00.000');
  assert.equal(await js(`document.querySelector('#currentTimeAnchor').classList.contains('seeking')`), false);
  // Duration refinement must not reset a user's position to zero.
  await js(`window.mockSeekDelayMs=0;window.mockPlayer.duration+=0.25;void 0;`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await js(`document.querySelector('#currentTime').textContent`), '90:00:00.000');
  for (const width of [1440, 1100, 900, 640]) {
    win.setSize(width, width === 1100 ? 732 : 1000);
    await new Promise(resolve => setTimeout(resolve, 100));
    const geometry = await js(`(() => {
      const ruler = document.querySelector('#timelineRuler').getBoundingClientRect();
      const labels = [...document.querySelectorAll('.timeline-ruler-tick-label')].map(el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,text:el.textContent};}).sort((a,b)=>a.left-b.left);
      const time = document.querySelector('#currentTime').getBoundingClientRect();
      const controls = document.querySelector('.transport .button-row').getBoundingClientRect();
      return {ruler:{left:ruler.left,right:ruler.right},labels,timeRight:time.right,controlsLeft:controls.left,controlsTop:controls.top,timeBottom:time.bottom,rangeBottom:document.querySelector(".markers").getBoundingClientRect().bottom,rangeFits:document.querySelector("#rangeSummary").scrollWidth<=document.querySelector("#rangeSummary").clientWidth,toolbarOverflow:document.querySelector(".source-toolbar").scrollWidth>document.querySelector(".source-toolbar").clientWidth,overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    assert.equal(geometry.overflow, false, `no horizontal overflow at ${width}`);
    assert.ok(geometry.timeRight <= geometry.controlsLeft + 1 || geometry.timeBottom <= geometry.controlsTop, `time and buttons do not overlap at ${width}`);
    if (width === 1100) assert.ok(geometry.rangeBottom <= 732, "100-hour controls fit minimum window");
    assert.ok(geometry.rangeFits, `readable range summary at ${width}`);
    assert.equal(geometry.toolbarOverflow, false, `toolbar fits at ${width}`);
    for (let index=0;index<geometry.labels.length;index++) {
      const label=geometry.labels[index];
      assert.ok(label.left>=geometry.ruler.left && label.right<=geometry.ruler.right, `${width}: label inside ruler`);
      if (index) assert.ok(geometry.labels[index-1].right<label.left, `${width}: labels do not overlap`);
    }
    assert.match(geometry.labels.at(-1).text, /^100:/);
    for (const ratio of [0.01,0.5,0.99]) {
      await js(`window.testSeek(${ratio});void 0;`);
      const result=await js(`({actual:window.mockPlayer.getCurrentTime(),expected:window.mockPlayer.duration*${ratio}})`);
      assert.ok(Math.abs(result.actual-result.expected)<0.01, `${width}: exact pointer mapping`);
    }
  }
  // Zoomed ruler and track must use the same viewport and must not pan during a drag.
  await js(`window.testSeek(0.5);document.querySelector('#timelineZoomInButton').click();void 0;`);
  const viewport = await js(`({min:Number(document.querySelector('#timelineInput').min),max:Number(document.querySelector('#timelineInput').max)})`);
  await js(`window.testSeek(0.75, 'timelineRuler');void 0;`);
  assert.ok(Math.abs(await js('window.mockPlayer.getCurrentTime()')-(viewport.min+(viewport.max-viewport.min)*0.75))<0.01);
  await new Promise(resolve => setTimeout(resolve, 100));
  if (process.argv.includes('--screenshot')) {
    const file = '/tmp/kawai-long-timeline.png';
    await require('node:fs/promises').writeFile(file, (await win.webContents.capturePage()).toPNG());
    console.log(file);
  }
  console.log('Native preview default; delayed and superseded seeks; duration refinement; 100-hour ruler/controls at 640/900/1440px; zoomed pointer mapping passed.');
  win.destroy(); server.close(); clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); server.close(); app.exit(1); });
