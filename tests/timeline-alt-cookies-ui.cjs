// Renderer-only checks; no real browser cookies or network media are used.
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
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    while (document.querySelector('#endTime')?.textContent !== '10:00.000') await wait(50);
    const areas = ['timelineRuler', 'timelineShell'].map(id => document.getElementById(id));
    const highlighted = () => areas.every(el => getComputedStyle(el, '::before').opacity === '1');
    const hidden = () => areas.every(el => getComputedStyle(el, '::before').opacity === '0');
    const rects = () => areas.map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    const alt = pressed => window.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
      key: 'Alt', code: 'AltLeft', altKey: pressed, bubbles: true
    }));
    const before = rects();
    const initiallyHidden = hidden();
    // Focus decoration is intentionally disabled; the Alt guide must still work.
    areas[0].focus(); alt(true);
    const bothHighlighted = highlighted();
    const after = rects();
    const pointerTransparent = areas.every(el => getComputedStyle(el, '::before').pointerEvents === 'none');
    const zooms = [];
    for (const area of areas) {
      const r = area.getBoundingClientRect();
      area.dispatchEvent(new WheelEvent('wheel', { altKey: true, deltaY: -100,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      zooms.push(document.querySelector('#timelineZoomLabel').textContent);
    }
    alt(false); const released = hidden();
    const zoomBefore = document.querySelector('#timelineZoomLabel').textContent;
    areas[1].dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    const normalWheelUnchanged = zoomBefore === document.querySelector('#timelineZoomLabel').textContent;
    alt(true); window.dispatchEvent(new Event('blur')); const blurCleared = hidden();
    window.dispatchEvent(new PointerEvent('pointermove', { altKey: true })); const recovered = highlighted();
    window.dispatchEvent(new PointerEvent('pointermove', { altKey: false })); const pointerCleared = hidden();
    document.querySelector('#openPreferenceOverlayButton').click(); await wait(100);
    const panel = document.querySelector('[role="dialog"]');
    const cookieCard = document.querySelector('.preference-cookies');
    const generalHasNoCookies = cookieCard.getBoundingClientRect().height === 0;
    const tab = text => [...panel.querySelectorAll('[role="tab"]')].find(el => el.textContent === text).click();
    tab('Cookies'); await wait(100);
    const cookiesVisible = cookieCard.getBoundingClientRect().height > 0;
    alt(true); const modalSuppressed = hidden(); alt(false);
    window.ytClipper.importBrowserCookies = () => new Promise(resolve => { window.completeExtraction = resolve; });
    document.querySelector('.cookie-actions button').click(); await wait(50);
    const busyBefore = document.querySelector('.cookie-actions button').getAttribute('aria-busy');
    const modalHeight = panel.getBoundingClientRect().height;
    tab('General'); await wait(50); tab('Cookies'); await wait(50);
    const busyRetained = document.querySelector('.cookie-actions button').getAttribute('aria-busy');
    window.completeExtraction({ configured: true, count: 4, previewApplied: true, previewCount: 2 }); await wait(100);
    const status = cookieCard.textContent;
    const stableHeight = panel.getBoundingClientRect().height === modalHeight;
    return { initiallyHidden, bothHighlighted, before, after, pointerTransparent, zooms, released,
      normalWheelUnchanged, blurCleared, recovered, pointerCleared, generalHasNoCookies, cookiesVisible,
      modalSuppressed, busyBefore, busyRetained, status, stableHeight };
  })()`);
  for (const key of ['initiallyHidden', 'bothHighlighted', 'pointerTransparent', 'released', 'normalWheelUnchanged',
    'blurCleared', 'recovered', 'pointerCleared', 'generalHasNoCookies', 'cookiesVisible', 'modalSuppressed', 'stableHeight']) {
    assert.equal(result[key], true, key);
  }
  assert.deepEqual(result.before, result.after);
  assert.notEqual(result.zooms[0], '1×'); assert.notEqual(result.zooms[0], result.zooms[1]);
  assert.equal(result.busyBefore, 'true'); assert.equal(result.busyRetained, 'true');
  assert.match(result.status, /4/); assert.match(result.status, /have not been verified/);
  if (process.argv.includes('--screenshot')) {
    const capture = async file => require('node:fs/promises').writeFile(file, (await win.webContents.capturePage()).toPNG());
    await capture('/tmp/kawai-cookie-tab.png');
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('.preference-close-button').click();
      await new Promise(resolve => setTimeout(resolve, 100));
      window.dispatchEvent(new KeyboardEvent('keydown', { key:'Alt', code:'AltLeft', altKey:true }));
      await new Promise(resolve => setTimeout(resolve, 100));
    })()`);
    await capture('/tmp/kawai-alt-timeline.png');
  }
  console.log('Alt borders, unchanged hit geometry, wheel zoom, modifier cleanup, Cookies tab and extraction state persistence passed');
  win.destroy(); server.close(); clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
