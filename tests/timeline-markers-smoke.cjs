// Run after bundle:renderer:dev: electron tests/timeline-markers-smoke.cjs
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
process.env.UI_HARNESS_PORT = '0';
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server, 'listening');
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  await ready;
  const win = new BrowserWindow({ show: false, width: 1400, height: 1000 });
  for (const source of ['https://www.youtube.com/watch?v=fixture', 'https://www.youtube.com/watch?v=fixture&t=120&end=180']) {
    await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor&sourceUrl=${encodeURIComponent(source)}`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const result = await win.webContents.executeJavaScript(`(() => {
      const marker = id => {
        const el = document.getElementById(id);
        const css = getComputedStyle(el);
        const before = getComputedStyle(el, '::before');
        const rect = el.getBoundingClientRect();
        return { display: css.display, left: el.style.left, width: rect.width, height: rect.height, color: css.color, content: before.content, border: before.borderStyle, position: css.position };
      };
      return { start: document.getElementById('startTime').textContent, end: document.getElementById('endTime').textContent, markers: [marker('startMarkerHandle'), marker('endMarkerHandle')] };
    })()`);
    console.log(JSON.stringify({source, ...result}));
    assert.equal(result.start, source.includes('t=120') ? '02:00.000' : '00:00.000');
    assert.equal(await win.webContents.executeJavaScript('window.mockPlayer.getCurrentTime()'), source.includes('t=120') ? 120 : 0);
    assert.equal(result.end, '10:00.000');
    assert.equal(result.markers[1].left, '100%');
    for (const marker of result.markers) {
      assert.notEqual(marker.display, 'none');
      assert.ok(marker.width > 0 && marker.height > 0);
      assert.equal(marker.border, 'solid');
    }
    await win.webContents.executeJavaScript('void (window.YT.Player.prototype.getDuration = () => 900)');
    await new Promise(resolve => setTimeout(resolve, 150));
    const updated = await win.webContents.executeJavaScript(`({
      end: document.getElementById('endTime').textContent,
      left: document.getElementById('endMarkerHandle').style.left,
      visible: getComputedStyle(document.getElementById('endMarkerHandle')).display !== 'none'
    })`);
    assert.deepEqual(updated, { end: '15:00.000', left: '100%', visible: true });
  }
  clearTimeout(deadline);
  win.destroy();
  server.close();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
