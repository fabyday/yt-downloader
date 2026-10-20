const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
process.env.UI_HARNESS_PORT='0';
const server=require('./ui-harness.cjs');
const ready=server.listening ? Promise.resolve() : once(server,'listening');
const deadline=setTimeout(()=>app.exit(1),40000);
app.whenReady().then(async()=>{
  await ready;
  // The editor viewport available inside the minimum 1100x820 native window.
  const win=new BrowserWindow({show:false,width:1100,height:732,useContentSize:true});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&sourceUrl=https://www.youtube.com/watch?v=fixture`);
  const js=code=>win.webContents.executeJavaScript(code);
  await js(`new Promise(resolve=>{const timer=setInterval(()=>{if(window.mockPlayer&&!document.querySelector('.preview-feedback')){clearInterval(timer);resolve();}},20);})`);
  await js(`window.seekRuler=time=>{
    const target=document.querySelector('#timelineRuler'),rect=target.getBoundingClientRect();
    const min=Number(document.querySelector('#timelineInput').min),max=Number(document.querySelector('#timelineInput').max);
    const options={bubbles:true,cancelable:true,button:0,pointerId:42,clientX:rect.left+rect.width*(time-min)/(max-min),clientY:rect.top+10};
    target.dispatchEvent(new PointerEvent('pointerdown',options));window.dispatchEvent(new PointerEvent('pointerup',options));
  };
  window.keys=(key,code,shiftKey=false)=>{
    const options={key,code,shiftKey,bubbles:true,cancelable:true};
    (document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',options));
    (document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keyup',options));
  };
  window.seekRuler(100);document.querySelector('#setStartButton').click();window.seekRuler(500);document.querySelector('#setEndButton').click();window.seekRuler(300);void 0;`);
  // Selectors own their bracket row; blank rows belong to playback.
  for(const [kind,time,delta,row] of [['start',100,60,'marker'],['end',500,-60,'marker'],['playhead',300,30,'top']]) {
    const result=await js(`(()=>{
      const area=document.querySelector('#timelineInteractionArea'),r=area.getBoundingClientRect();
      const track=document.querySelector('#timelineInput').getBoundingClientRect();
      const marker=document.querySelector(${JSON.stringify('#'+kind+'MarkerHandle')})?.getBoundingClientRect();
      const x=track.left+track.width*${time}/600+6,y=${JSON.stringify(row)}==='marker'?(marker.top+marker.bottom)/2:r.top+4;
      const target=document.elementFromPoint(x,y);
      const options={bubbles:true,cancelable:true,button:0,pointerId:42,clientX:x,clientY:y};
      const read=()=>Number(document.querySelector(${JSON.stringify(kind==='playhead'?'#currentTime':'#'+kind+'Time')}).getAttribute('aria-valuenow'));
      target.dispatchEvent(new PointerEvent('pointerdown',options));const pressed=read();
      window.dispatchEvent(new PointerEvent('pointermove',{...options,clientX:x+${delta}}));
      window.dispatchEvent(new PointerEvent('pointerup',{...options,clientX:x+${delta}}));
      return {hit:target.id,pressed,after:read(),expected:${time}+${delta}/track.width*600};
    })()`);
    assert.equal(result.pressed,time,`${kind}: no jump on grab inside tolerance`);
    assert.ok(Math.abs(result.after-result.expected)<0.001,`${kind}: blank ${row} drag uses track X`);
  }
  const ranges=await js(`({start:Number(document.querySelector('#startTime').getAttribute('aria-valuenow')),end:Number(document.querySelector('#endTime').getAttribute('aria-valuenow'))})`);
  await js(`window.seekRuler(${ranges.start});void 0;`);
  assert.equal(await js(`Number(document.querySelector('#startTime').getAttribute('aria-valuenow'))`),ranges.start,'ruler never edits selector');
  // Real DOM hit testing when the red playhead and a bracket share the same X.
  for (const kind of ['start', 'end']) {
    for (const row of ['ruler', 'above', 'below']) {
      await js(`window.seekRuler(${ranges[kind]});void 0;`);
      const result = await js(`(() => {
        const track=document.querySelector('#timelineInput').getBoundingClientRect();
        const marker=document.querySelector('#${kind}MarkerHandle').getBoundingClientRect();
        const ruler=document.querySelector('#timelineRuler').getBoundingClientRect();
        const x=track.left+track.width*${ranges[kind]}/600;
        const y=${JSON.stringify(row)}==='ruler'?ruler.top+10:${JSON.stringify(row)}==='above'?marker.top-4:marker.bottom+4;
        const target=document.elementFromPoint(x,y);
        const event={bubbles:true,cancelable:true,button:0,pointerId:43,clientX:x,clientY:y};
        const before=Number(document.querySelector('#${kind}Time').getAttribute('aria-valuenow'));
        target.dispatchEvent(new PointerEvent('pointerdown',event));
        window.dispatchEvent(new PointerEvent('pointermove',{...event,clientX:x+15}));
        window.dispatchEvent(new PointerEvent('pointerup',{...event,clientX:x+15}));
        return {hit:target.id,before,after:Number(document.querySelector('#${kind}Time').getAttribute('aria-valuenow')),
          playhead:Number(document.querySelector('#currentTime').getAttribute('aria-valuenow')),
          expected:${ranges[kind]}+15/track.width*600};
      })()`);
      assert.equal(result.hit,'currentTimeHandle',kind+' '+row+' hits red line');
      assert.equal(result.after,result.before,kind+' '+row+' must not change selection');
      assert.ok(Math.abs(result.playhead-result.expected)<0.01,kind+' '+row+' moves playhead');
    }
  }
  // Position a distinct playhead, then zoom around the start selector from the far-right wheel position.
  await js(`window.seekRuler(300);document.querySelector('#zoomPivot-start').click();void 0;`);
  const before=await js(`document.querySelector('#startMarkerHandle').getBoundingClientRect().left`);
  await js(`(()=>{const area=document.querySelector('#timelineInteractionArea'),r=area.getBoundingClientRect();area.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,altKey:true,deltaY:-100,clientX:r.right-1,clientY:r.top+4}));})()`);
  assert.ok(Math.abs(await js(`document.querySelector('#startMarkerHandle').getBoundingClientRect().left`)-before)<0.01,'selected pivot stays at same pixel regardless of wheel X');
  await js(`document.body.focus();window.keys('3','Digit3');window.keys('ArrowUp','ArrowUp',true);void 0;`);
  assert.equal(await js(`document.querySelector('#zoomPivot-end').getAttribute('aria-pressed')`),'true');
  await new Promise(resolve=>setTimeout(resolve,100));
  const viewBefore=await js(`document.querySelector('#timelineViewportLabel').textContent`);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await js(`document.querySelector('#timelineViewportLabel').textContent`),viewBefore,'ticker does not override selector pivot');
  await js(`window.keys('1','Digit1');window.keys(')','Digit0',true);void 0;`);
  assert.equal(await js(`document.querySelector('#timelineZoomLabel').textContent`),'1×');
  assert.equal(await js(`document.querySelector('#zoomPivot-playhead').getAttribute('aria-pressed')`),'true');
  await js(`document.querySelector('#currentTimeHandle').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,altKey:true,deltaY:-100}));void 0;`);
  assert.equal(await js(`document.querySelector('#timelineZoomLabel').textContent`),'1.25×','wheel over unified playhead zooms once');
  await js(`window.keys(')','Digit0',true);void 0;`);
  await js(`document.querySelector('#volumeButton').click();void 0;`);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(await js(`document.activeElement.id`),'volumeSlider');
  await js(`window.keys('ArrowDown','ArrowDown');void 0;`);
  assert.equal(await js(`document.querySelector('video').volume`),0.95);
  assert.equal(await js(`document.querySelector('#volumeSlider').value`),'95');
  await js(`window.keys('m','KeyM');void 0;`);
  assert.equal(await js(`document.querySelector('video').muted`),true);
  await js(`window.keys('ArrowUp','ArrowUp');window.keys('Escape','Escape');void 0;`);
  assert.equal(await js(`document.querySelector('video').volume`),1);
  assert.equal(await js(`document.querySelector('video').muted`),false);
  assert.equal(await js(`document.querySelector('#volumeButton').getAttribute('aria-expanded')`),'false');
  assert.equal(await js(`document.activeElement.id`),'volumeButton');
  // Custom bindings are honored and persist through the existing settings API.
  await js(`(async()=>{const p=await window.ytClipper.getPreferences();await window.ytClipper.updatePreferences({...p,shortcuts:{...p.shortcuts,volumeDown:'K'}});window.keys('k','KeyK');})()`);
  assert.equal(await js(`document.querySelector('video').volume`),0.95);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(await js(`window.ytClipper.getPreferences().then(p=>p.previewVolume)`),0.95);
  await js(`window.keys('v','KeyV');void 0;`);
  await new Promise(resolve=>setTimeout(resolve,50));
  const sliderPoint=await js(`(()=>{const r=document.querySelector('#volumeSlider').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height*0.75)};})()`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...sliderPoint});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...sliderPoint});
  await new Promise(resolve=>setTimeout(resolve,80));
  const mouseVolume=await js(`document.querySelector('video').volume`);
  assert.ok(mouseVolume>=0.15&&mouseVolume<=0.35,'vertical mouse input adjusts real media volume');
  // Pointer endpoints must reach exactly 0/100, with the visible thumb centered on the track ends.
  for (const [edge, expected] of [['top', 1], ['bottom', 0]]) {
    const point=await js(`(()=>{const r=document.querySelector('#volumeSlider').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(${JSON.stringify(edge)}==='top'?r.top+1:r.bottom-1)};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(await js(`document.querySelector('video').volume`),expected);
    const geometry=await js(`(()=>{const t=document.querySelector('.volume-slider-track').getBoundingClientRect(),h=document.querySelector('.volume-slider-thumb').getBoundingClientRect();return {center:h.top+h.height/2,end:${JSON.stringify(edge)}==='top'?t.top:t.bottom};})()`);
    assert.ok(Math.abs(geometry.center-geometry.end)<0.1,'thumb reaches visible track endpoint');
  }
  for (const [level, waves] of [[20,1],[50,2],[100,3]]) {
    await js(`(()=>{const s=document.querySelector('#volumeSlider');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,${level});s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await js(`document.querySelectorAll('#volumeButton [data-volume-wave]').length`),waves);
  }
  await js(`document.querySelector('#muteButton').click();void 0;`);
  assert.equal(await js(`getComputedStyle(document.querySelector('#muteButton')).color`),'rgb(255, 77, 94)');
  assert.equal(await js(`document.querySelector('#muteButton').textContent`),'');
  await js(`document.querySelector('#muteButton').click();void 0;`);
  assert.equal(await js(`getComputedStyle(document.querySelector('#muteButton')).color`),'rgb(255, 255, 255)');
  assert.ok(await js(`document.querySelector('#volumePopover').getBoundingClientRect().width <= document.querySelector('#volumeButton').getBoundingClientRect().width+6`));
  const bounds=await js(`(()=>{const popup=document.querySelector('#volumePopover').getBoundingClientRect(),range=document.querySelector('.markers').getBoundingClientRect();return {popup:popup.top>=0&&popup.bottom<=innerHeight&&document.elementFromPoint(popup.left+popup.width/2,popup.top+8)?.closest("#volumePopover")!==null,range:range.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.deepEqual(bounds,{popup:true,range:true,overflow:false});
  const dock=await js(`(()=>{
    const range=document.querySelector('.markers').getBoundingClientRect(),rules=document.querySelector('.selection-rules-panel').getBoundingClientRect();
    const buttons=[...document.querySelectorAll('.marker-row button')];
    return {compact:range.width<=430&&rules.width>range.width,aligned:Math.abs(range.top-rules.top)<1,
      fits:buttons.every(b=>b.scrollWidth<=b.clientWidth&&b.getBoundingClientRect().right<=range.right),
      singleRows:[...document.querySelectorAll('.selection-mode-controls')].every(g=>new Set([...g.children].map(b=>Math.round(b.getBoundingClientRect().top))).size===1)};
  })()`);
  assert.deepEqual(dock,{compact:true,aligned:true,fits:true,singleRows:true});
  if(process.argv.includes('--screenshot')) await require('node:fs/promises').writeFile('/tmp/kawai-timeline-controls.png',(await win.webContents.capturePage()).toPNG());
  console.log('Gap hit testing/drag offsets, ruler-only scrubbing, pivot wheel/buttons/shortcuts, volume/mute/popup/custom shortcuts, persisted settings, minimum-size layout passed.');
  win.destroy();server.close();clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error);server.close();app.exit(1);});
