const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
process.env.UI_HARNESS_PORT='0';
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server,'listening');
const deadline=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
  await ready;
  const win=new BrowserWindow({show:false,width:1440,height:1000});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&sourceUrl=https://www.youtube.com/watch?v=fixture`);
  const js=script=>win.webContents.executeJavaScript(script);
  await js(`new Promise(resolve=>{const timer=setInterval(()=>{if(window.mockPlayer&&document.querySelector('#endTime')?.textContent==='10:00.000'){clearInterval(timer);resolve();}},50);})`);
  await js(`window.testSeek = time => {
    const input=document.querySelector('#timelineRuler');const rect=input.getBoundingClientRect();
    const options={bubbles:true,cancelable:true,button:0,pointerId:42,clientX:rect.left+rect.width*time/600,clientY:rect.top+10};
    input.dispatchEvent(new PointerEvent('pointerdown',options));
    window.dispatchEvent(new PointerEvent('pointerup',options));
  }; void 0;`);
  const key=async keyCode=>{
    win.webContents.sendInputEvent({type:'keyDown',keyCode});
    win.webContents.sendInputEvent({type:'keyUp',keyCode});
    await new Promise(resolve=>setTimeout(resolve,80));
  };
  for(const id of ['setStartButton','forwardSmallButton','timelineInput','currentTimeHandle','timelineRuler','startTime','loopToggle']) {
    const before=await js(`(()=>{
      window.mockPlayer.pauseVideo();window.testSeek(100);
      document.querySelector('#${id}').focus();
      window.focusClicks=0;document.querySelector('#${id}').onclick=()=>window.focusClicks++;
      return {start:document.querySelector('#startTime').textContent,checked:document.querySelector('#loopToggle').checked};
    })()`);
    await key('Space');
    assert.equal(await js('window.mockPlayer.getPlayerState()'),1,`${id}: space plays`);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',repeat:true,bubbles:true,cancelable:true}));void 0;`);
    assert.equal(await js('window.mockPlayer.getPlayerState()'),1,`${id}: held Space does not repeatedly toggle`);
    await key('Space');
    const after=await js(`({state:window.mockPlayer.getPlayerState(),clicks:window.focusClicks,start:document.querySelector('#startTime').textContent,checked:document.querySelector('#loopToggle').checked})`);
    assert.equal(after.state,2,`${id}: space pauses`);assert.equal(after.clicks,0,`${id}: no native click`);
    assert.equal(after.start,before.start);assert.equal(after.checked,before.checked);
    await js('window.testSeek(100)');
    await new Promise(resolve=>setTimeout(resolve,80));
    await key('Right');
    assert.ok(Math.abs(await js('window.mockPlayer.getCurrentTime()')-101)<1e-6,`${id}: one global seek, not slider/marker adjustment`);
    assert.equal(await js("document.querySelector('#startTime').textContent"),before.start);
  }
  const editing=await js(`(()=>{
    const input=document.querySelector('#urlInput');input.focus();
    const event=new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true});input.dispatchEvent(event);
    return {prevented:event.defaultPrevented,state:window.mockPlayer.getPlayerState()};
  })()`);
  assert.equal(editing.prevented,false);assert.equal(editing.state,2);
  const geometry=await js(`(async()=>{
    const positions=[];
    for(const time of [0,300,600]) {
      window.testSeek(time);await new Promise(resolve=>setTimeout(resolve,100));
      const ruler=document.querySelector('#timelineRuler').getBoundingClientRect();
      const surface=document.querySelector('.timeline-surface').getBoundingClientRect();
      const line=document.querySelector('.timeline-current-line').getBoundingClientRect();
      const shell=document.querySelector('#timelineShell').getBoundingClientRect();
      positions.push({time,top:line.top,rulerTop:ruler.top,bottom:line.bottom,surfaceBottom:surface.bottom-1,lineX:line.left+line.width/2,expected:shell.left+Math.max(1.5,Math.min(shell.width-1.5,shell.width*time/600))});
    }
    const handle=getComputedStyle(document.querySelector('#currentTimeHandle'));
    return {positions,color:getComputedStyle(document.querySelector('.timeline-current-line')).backgroundColor,background:handle.backgroundColor,shadow:handle.boxShadow,triangle:getComputedStyle(document.querySelector('.timeline-current-line'),'::after').content};
  })()`);
  for(const point of geometry.positions){assert.ok(Math.abs(point.top-point.rulerTop)<0.6);assert.ok(Math.abs(point.bottom-point.surfaceBottom)<0.6);assert.ok(Math.abs(point.lineX-point.expected)<0.6);}
  assert.equal(await js(`document.querySelectorAll('.timeline-current-line').length`),1);
  assert.equal(await js(`document.querySelector('#timelineRulerPlayhead')`),null);
  assert.equal(geometry.color,'rgb(255, 77, 94)');assert.equal(geometry.background,'rgba(0, 0, 0, 0)');assert.equal(geometry.shadow,'none');assert.equal(geometry.triangle,'none');
  if(process.argv.includes('--screenshot')) {
    const bounds=await js(`(()=>{const r=document.querySelector('.timeline-panel').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`);
    const output=`/tmp/kawai-timeline-redline-${process.pid}.png`;
    await require('node:fs/promises').writeFile(output,(await win.webContents.capturePage(bounds)).toPNG());
    console.log(output);
  }
  console.log('Timeline: red line aligned at start/middle/end; Space/arrow keys independent of button, marker, slider and checkbox focus; text editing preserved');
  win.destroy();server.close();clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error);server.close();app.exit(1);});
