const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
process.env.UI_HARNESS_PORT = '0';
const server = require('./ui-harness.cjs');
const ready = server.listening ? Promise.resolve() : once(server, 'listening');
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  await ready;
  const win = new BrowserWindow({ show: false, width: 1200, height: 950 });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=editor`);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    while (!document.querySelector('#openPreferenceOverlayButton')) await wait(50);
    let state = { development: true, state: 'disconnected' }, approve, requests = 0;
    window.ytClipper.developmentConnection = async operation => {
      if (operation === 'connect') {
        requests++;
        state = { development: true, state: 'connecting' };
        await new Promise(resolve => { approve = resolve; });
        state = { development: true, state: 'connected', hostId: 'fixture' };
      } else if (operation === 'disconnect') {
        state = { development: true, state: 'disconnected' };
      }
      return state;
    };
    document.querySelector('#openPreferenceOverlayButton').click();
    while (!document.querySelector('#developmentConnectionButton')) await wait(30);
    const button = document.querySelector('#developmentConnectionButton');
    const isolated = !document.querySelector('#openKawaikaraButton');
    button.click(); await wait(50); button.click();
    const guarded = button.disabled && requests === 1;
    approve(); await wait(80);
    const connected = !button.disabled && button.textContent.includes('Disconnect') &&
      button.parentElement.textContent.includes('Connected to Kawaikara Dev');
    button.click(); await wait(80);
    const pending = !button.disabled && button.textContent.includes('Connect manually') && button.parentElement.textContent.includes('Disconnected');
    return { isolated, guarded, connected, pending };
  })()`);
  for (const [key, value] of Object.entries(result)) assert.equal(value, true, key);
  console.log('Development connection UI: mode isolation, pending approval, connected state and durable disconnect presentation passed');
  win.destroy(); server.close(); clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); server.close(); app.exit(1); });
