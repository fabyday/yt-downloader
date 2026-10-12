const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
process.env.UI_HARNESS_PORT = '0';
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server, 'listening');
const deadline = setTimeout(() => app.exit(1), 30000);

app.whenReady().then(async () => {
  await ready;
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000 });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&sourceUrl=https://www.youtube.com/watch?v=fixture`);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const el = id => document.getElementById(id);
    while (el('endTime')?.textContent !== '10:00.000') await wait(50);
    const key = letter => document.body.dispatchEvent(new KeyboardEvent('keydown', {key:letter.toLowerCase(),code:'Key'+letter,bubbles:true,cancelable:true}));
    const opts = {bubbles:true,cancelable:true,pointerId:12,button:0};
    const at = time => {
      const r = el('timelineInput').getBoundingClientRect();
      return {...opts,clientX:r.left+r.width*time/600,clientY:r.top+5};
    };
    const pointer = (target, type, position) => target.dispatchEvent(new PointerEvent(type,position));
    const seek = async time => {
      pointer(el('timelineInput'),'pointerdown',at(time));
      pointer(window,'pointerup',at(time)); await wait(100);
    };
    const setup = async () => {
      window.mockPlayer.pauseVideo(); key('E'); el('resetSelectionButton').click();
      await seek(100); key('A'); await seek(200); key('S');
    };
    const read = () => ({time:window.mockPlayer.getCurrentTime(),display:el('currentTime').textContent,state:window.mockPlayer.getPlayerState()});
    const play = () => el('playPauseButton').click();
    await setup(); key('Q'); await seek(150);
    if (!el('loopToggle').checked) el('loopToggle').click();
    play();
    pointer(el('endMarkerHandle'),'pointerdown',at(140));
    await wait(250);
    pointer(window,'pointermove',at(160));
    await wait(200);
    pointer(window,'pointerup',at(160));
    await wait(1500); const end = read();

    await setup(); key('Q'); await seek(150); play();
    pointer(el('startMarkerHandle'),'pointerdown',at(160));
    await wait(250);
    pointer(window,'pointermove',at(130));
    pointer(window,'pointerup',at(130));
    await wait(1500); const start = read();

    // A stale player acknowledgement must not detach a caught playhead mid-drag.
    await setup(); key('Q'); await seek(150);
    const originalSeek = window.mockPlayer.seekTo.bind(window.mockPlayer);
    let seekTimer;
    window.mockPlayer.seekTo = time => { clearTimeout(seekTimer); seekTimer=setTimeout(()=>originalSeek(time),200); };
    pointer(el('endMarkerHandle'),'pointerdown',at(140));
    await wait(1400);
    pointer(window,'pointermove',at(160));
    pointer(window,'pointerup',at(160));
    await wait(400); const delayed = read();
    window.mockPlayer.seekTo = originalSeek;

    await setup(); key('Q'); await seek(150); play();
    const readout = el('endTime'), readoutRect = readout.getBoundingClientRect();
    const readoutOrigin = {...opts,clientX:readoutRect.left+10,clientY:readoutRect.top+5};
    pointer(readout,'pointerdown',readoutOrigin);
    pointer(window,'pointermove',{...readoutOrigin,clientX:readoutOrigin.clientX-el('timelineShell').clientWidth*60/600});
    await wait(250);
    pointer(window,'pointermove',{...readoutOrigin,clientX:readoutOrigin.clientX-el('timelineShell').clientWidth*40/600});
    pointer(window,'pointercancel',readoutOrigin);
    await wait(200); const readoutEnd = read();

    const independent = [];
    for (const mode of ['E','W']) {
      await setup(); key(mode); await seek(150); play();
      pointer(el('endMarkerHandle'),'pointerdown',at(140));
      pointer(window,'pointerup',at(140)); await wait(100);
      independent.push(read());
    }

    await setup();
    pointer(el('startMarkerHandle'),'pointerdown',at(200));
    pointer(window,'pointerup',at(200));
    const tag = el('splitStartMarker'), r = tag.getBoundingClientRect();
    const tagShapes = ['splitStartMarker','splitEndMarker'].map(id => ({
      clip:getComputedStyle(el(id)).clipPath,
      innerClip:getComputedStyle(el(id),'::before').clipPath,
      text:el(id).textContent
    }));
    const origin = {...opts,clientX:r.left+r.width/2,clientY:r.top+8};
    pointer(tag,'pointerdown',origin);
    const delta = el('timelineInput').clientWidth*50/600;
    pointer(window,'pointermove',{...origin,clientX:origin.clientX-delta});
    const tagDelta = r.left-tag.getBoundingClientRect().left;
    const tagVisible = !el('markerSplitTags').classList.contains('hidden');
    pointer(window,'pointerup',origin);
    pointer(el('startMarkerHandle'),'pointerdown',at(200));
    pointer(window,'pointerup',at(200));
    key('Q'); await seek(200);
    const endTag = el('splitEndMarker'), endRect = endTag.getBoundingClientRect();
    const endOrigin = {...opts,clientX:endRect.left+endRect.width/2,clientY:endRect.top+8};
    pointer(endTag,'pointerdown',endOrigin);
    pointer(window,'pointermove',{...endOrigin,clientX:endOrigin.clientX+delta});
    const endTagDelta = endTag.getBoundingClientRect().left-endRect.left;
    await wait(200);
    pointer(window,'pointerup',endOrigin);
    await wait(150); const tagPlayhead = read();

    const edgeTags = [];
    for (const time of [0,600]) {
      key('E');
      pointer(el('startMarkerHandle'),'pointerdown',at(time));
      pointer(window,'pointerup',at(time));
      pointer(el('endMarkerHandle'),'pointerdown',at(time));
      pointer(window,'pointerup',at(time));
      const a=el('splitStartMarker').getBoundingClientRect(),b=el('splitEndMarker').getBoundingClientRect(),track=el('timelineShell').getBoundingClientRect();
      edgeTags.push(a.left>=track.left-1 && b.right<=track.right+1 && a.right<b.left);
    }
    return {end,start,delayed,readoutEnd,independent,tagDelta,endTagDelta,delta,tagVisible,tagPlayhead,edgeTags,tagShapes};
  })()`);
  console.log(result);
  for (const [name, time] of [['end',160],['start',130],['delayed',160],['readoutEnd',160],['tagPlayhead',250]]) {
    assert.ok(Math.abs(result[name].time-time)<0.01, `${name} remains at released marker`);
    assert.equal(result[name].state,2,`${name} is paused`);
  }
  for (const item of result.independent) {
    assert.equal(item.state,1,'free/follow marker drag keeps playing');
    assert.ok(item.time>=150 && item.time<151,'free/follow playhead stays independent');
  }
  assert.equal(result.tagVisible,true);
  assert.ok(Math.abs(result.tagDelta-result.delta)<1,'tag follows its own marker during drag');
  assert.ok(Math.abs(result.endTagDelta-result.delta)<1,'end tag follows its own marker');
  assert.ok(result.edgeTags.every(Boolean),'both tags stay accessible at either timeline edge');
  for (const shape of result.tagShapes) {
    assert.match(shape.clip,/^polygon\(/,'tag outline is a shaped polygon');
    assert.equal(shape.innerClip,shape.clip,'inner fill follows the outline');
    assert.doesNotMatch(shape.text,/[<>‹›]/,'direction is conveyed by shape, not text');
  }
  assert.notEqual(result.tagShapes[0].clip,result.tagShapes[1].clip,'start/end face opposite directions');
  win.destroy(); server.close(); clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); server.close(); app.exit(1); });
