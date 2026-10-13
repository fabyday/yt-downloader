// Offline renderer integration: metadata-only download and explicit generic cookie import.
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
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor`);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms)), el = id => document.getElementById(id);
      while (!el('urlInput')) await wait(30);
      const requests = [], imported = [], queued = [];
      window.ytClipper.resolvePreview = async key => { requests.push(key); return {ok:false,error:'preview.unavailable',title:'Generic fixture',duration:123}; };
      window.ytClipper.enqueueDownload = async item => { queued.push(item); return [item]; };
      el('urlInput').value = 'https://vimeo.com/76979871'; el('loadButton').click();
      for (let i=0;i<100 && el('endTime').textContent !== '02:03.000';i++) await wait(30);
      const range = [el('startTime').textContent, el('endTime').textContent];
      const filename = el('basenameInput').value;
      el('downloadButton').click(); await wait(150);
      const feedback = document.querySelector('.preview-feedback')?.textContent;
      window.ytClipper.getCookieStatus = async () => ({configured:false,count:0,sites:{generic:{configured:false,count:0}}});
      window.ytClipper.importCookies = async site => { imported.push(site); return {configured:true,count:1,sites:{generic:{configured:true,count:1}}}; };
      el('openPreferenceOverlayButton').click(); await wait(100);
      [...document.querySelectorAll('[role=tab]')].find(node=>node.textContent==='Cookies').click(); await wait(100);
      el('cookieSiteSelect').click(); await wait(50);
      [...document.querySelectorAll('[role=option]')].find(node=>node.textContent.includes('Other sites')).click(); await wait(100);
      const buttons = [...document.querySelectorAll('.cookie-actions button')];
      buttons[0].click(); await wait(100);
      return { requests, range, filename, feedback, queued:queued.map(item=>({url:item.payload.url,segments:item.payload.segments})),
        imported, actions:buttons.map(button=>button.textContent), guide:document.querySelector('.preference-cookies').textContent };
    })()`);
    assert.deepEqual(result.requests, ['web:https://vimeo.com/76979871']);
    assert.deepEqual(result.range, ['00:00.000', '02:03.000']);
    assert.match(result.filename, /^clip-vimeo.com-/);
    assert.equal(result.queued[0].segments[0].end, 123);
    assert.equal(result.queued[0].url, 'https://vimeo.com/76979871');
    assert.deepEqual(result.imported, ['generic']);
    assert.ok(!result.actions.some(text=>text.includes('Extract')));
    assert.match(result.guide, /separate jar/);
    console.log('Generic metadata-only download and cookie-file UI passed.');
  } finally { win.destroy(); }
  server.close(); clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); server.close(); app.exit(1); });
