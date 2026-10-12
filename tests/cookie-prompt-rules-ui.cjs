// UI-only browser lifecycle tests. Never closes a real browser or reads cookies.
const assert=require('node:assert/strict');
const {app,BrowserWindow}=require('electron');
const {once}=require('node:events');
process.env.UI_HARNESS_PORT='0';
const server=require('./ui-harness.cjs');
const ready=server.listening?Promise.resolve():once(server,'listening');
const deadline=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
  await ready;
  const win=new BrowserWindow({show:false,width:1440,height:1000});
  const js=code=>win.webContents.executeJavaScript(code);
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&platform=darwin&sourceUrl=https://www.youtube.com/watch?v=fixture`);
  const initial=await js(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    while(document.querySelector('#endTime')?.textContent!=='10:00.000')await wait(50);
    const panel=document.querySelector('.selection-rules-panel'),title=document.querySelector('#selectionRulesTitle');
    const panelRect=panel.getBoundingClientRect(),button=document.querySelector('#selectionMode-clamp').getBoundingClientRect();
    const rules={title:title.textContent,border:getComputedStyle(panel).borderTopStyle,leftAligned:Math.abs(button.left-title.getBoundingClientRect().left)<1,inside:button.left>=panelRect.left&&button.right<=panelRect.right};
    document.querySelector('#selectionMode-clamp').click();await wait(50);
    rules.modeWorks=document.querySelector('#selectionMode-clamp').getAttribute('aria-pressed')==='true';
    window.browserRunning=true;window.imports=0;window.accessCalls=0;
    window.ytClipper.getBrowserCookieStatus=async()=>({running:window.browserRunning});
    const info=await window.ytClipper.getAppInfo();window.ytClipper.getAppInfo=async()=>({...info,platform:'darwin'});
    window.ytClipper.importBrowserCookies=async()=>{window.imports++;return {configured:true,count:2};};
    window.ytClipper.requestCookieAccess=async()=>{window.accessCalls++;};
    document.querySelector('#openPreferenceOverlayButton').click();await wait(100);
    [...document.querySelectorAll('[role=tab]')].find(el=>el.textContent==='Cookies').click();await wait(100);
    const extract=document.querySelector('.cookie-actions button');const enabled=!extract.disabled;
    extract.click();await wait(100);
    const popup=document.querySelector('.browser-close-prompt');
    const theme={button:getComputedStyle(popup.querySelector('.cookie-button-primary')).backgroundColor,expectedButton:getComputedStyle(extract).backgroundColor,title:getComputedStyle(popup.querySelector('#browserCloseTitle')).color,expectedTitle:getComputedStyle(title).color};
    return {rules,theme,enabled,open:popup?.open,modal:popup?.matches(':modal'),text:popup?.textContent,imports:window.imports};
  })()`);
  assert.equal(initial.rules.title,'Selection rules');assert.equal(initial.rules.border,'solid');assert.equal(initial.rules.leftAligned,true);assert.equal(initial.rules.inside,true);assert.equal(initial.rules.modeWorks,true);
  assert.equal(initial.enabled,true);assert.equal(initial.open,true);assert.equal(initial.modal,true);assert.match(initial.text,/Chrome/);assert.match(initial.text,/⌘Q/);assert.equal(initial.imports,0);
  assert.equal(initial.theme.button,initial.theme.expectedButton);assert.equal(initial.theme.title,initial.theme.expectedTitle);
  const targets=await js(`(()=>{
    const popup=document.querySelector('.browser-close-prompt'),status=popup.querySelector('.browser-close-status');
    window.promptText=status.textContent;window.promptChanges=[];
    window.promptObserver=new MutationObserver(()=>window.promptChanges.push(status.textContent));
    window.promptObserver.observe(status,{subtree:true,childList:true,characterData:true});
    window.ytClipper.getBrowserCookieStatus=async()=>{await new Promise(r=>setTimeout(r,500));return {running:window.browserRunning};};
    const bounds=el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};};
    return {button:bounds(popup.querySelector('.cookie-button-primary')),title:bounds(popup.querySelector('#browserCloseTitle'))};
  })()`);
  // Real Chromium pointer events, not synthetic DOM clicks: reproduce double-click selection.
  win.webContents.sendInputEvent({type:'mouseDown',...targets.button,button:'left',clickCount:2});
  win.webContents.sendInputEvent({type:'mouseUp',...targets.button,button:'left',clickCount:2});
  const during=await js(`(async()=>{
    await new Promise(r=>setTimeout(r,60));
    return {text:document.querySelector('.browser-close-status').textContent,expected:window.promptText,busy:document.querySelector('.browser-close-prompt .cookie-button-primary').disabled,selection:window.getSelection().toString()};
  })()`);
  assert.equal(during.text,during.expected);assert.equal(during.busy,true);assert.equal(during.selection,'');
  win.webContents.sendInputEvent({type:'mouseDown',...targets.title,button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseMove',x:targets.title.x+100,y:targets.title.y,button:'left'});
  win.webContents.sendInputEvent({type:'mouseUp',x:targets.title.x+100,y:targets.title.y,button:'left',clickCount:1});
  const stable=await js(`(async()=>{
    await new Promise(r=>setTimeout(r,600));
    window.promptObserver.disconnect();
    window.ytClipper.getBrowserCookieStatus=async()=>({running:window.browserRunning});
    const popup=document.querySelector('.browser-close-prompt');
    return {changes:window.promptChanges,selection:window.getSelection().toString(),button:getComputedStyle(popup.querySelector('button')).userSelect,title:getComputedStyle(popup.querySelector('#browserCloseTitle')).userSelect,input:getComputedStyle(document.querySelector('input')).userSelect};
  })()`);
  assert.deepEqual(stable.changes,[]);assert.equal(stable.selection,'');assert.equal(stable.button,'none');assert.equal(stable.title,'none');assert.equal(stable.input,'text');
  if(process.argv.includes('--screenshot'))await require('node:fs/promises').writeFile('/tmp/kawai-close-browser-prompt.png',(await win.webContents.capturePage()).toPNG());
  const retried=await js(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const retry=()=>document.querySelector('.browser-close-prompt .cookie-button-primary').click();
    retry();await wait(100);const stillOpen=document.querySelector('.browser-close-prompt')?.open;
    const noEarlyImport=window.imports===0;
    window.browserRunning=false;await wait(2200);
    const noAutoImport=window.imports===0;
    retry();await wait(100);
    return {stillOpen,noEarlyImport,noAutoImport,imports:window.imports,closed:!document.querySelector('.browser-close-prompt')};
  })()`);
  assert.equal(retried.stillOpen,true);assert.equal(retried.noEarlyImport,true);assert.equal(retried.noAutoImport,true);assert.equal(retried.imports,1);assert.equal(retried.closed,true);
  const cancel=await js(`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,100));
    window.browserRunning=true;
    const access=[...document.querySelectorAll('.cookie-permission-help button')].find(el=>el.textContent==='Authorize & extract');
    const enabled=!access.disabled;access.click();await wait();
    const prompt=document.querySelector('.browser-close-prompt');const opened=prompt?.open;
    prompt.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    prompt.dispatchEvent(new Event('cancel',{cancelable:true}));await wait();
    const cancelled=!document.querySelector('.browser-close-prompt')&&!!document.querySelector('.preference-overlay-panel');
    access.click();await wait();window.browserRunning=false;
    document.querySelector('.browser-close-prompt .cookie-button-primary').click();await wait();
    return {enabled,opened,cancelled,access:window.accessCalls,imports:window.imports};
  })()`);
  assert.equal(cancel.enabled,true);assert.equal(cancel.opened,true);assert.equal(cancel.cancelled,true);assert.equal(cancel.access,1);assert.equal(cancel.imports,2);
  await js(`document.querySelector('.preference-close-button').click();new Promise(r=>setTimeout(r,100))`);
  if(process.argv.includes('--screenshot'))await require('node:fs/promises').writeFile('/tmp/kawai-selection-rules-panel.png',(await win.webContents.capturePage()).toPNG());
  console.log('Stable retry text, native double-click/drag selection prevention, editable inputs, clickable extraction, modal quit instructions, fresh checks/retry, no auto-import, cancel/authorization, selection rules passed');
  win.destroy();server.close();clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
