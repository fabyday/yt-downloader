const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const { CompanionCookies } = require('../src/Worker/CompanionCookies');
const { CompanionManager } = require('../src/Main/Manager/CompanionManager');
const url = 'https://www.youtube.com/watch?v=abcdefghijk';
const data = { format: 'records', cookies: [{ domain: '.youtube.com', name: 'SID', value: 'private-value', path: '/', secure: true, httpOnly: true }] };

test('companion cookies are request/source scoped, disposable, and public-only when denied', async () => {
  const store = new CompanionCookies();
  store.set('request-1', url, data);
  assert.equal(await store.snapshot('request-2', url), null);
  assert.equal(await store.snapshot('request-1', 'https://www.youtube.com/watch?v=other-id123'), null);
  const snapshot = await store.snapshot('request-1', url);
  assert.match(await fs.readFile(snapshot.path, 'utf8'), /private-value/);
  assert.equal((await fs.stat(snapshot.path)).mode & 0o777, 0o600);
  await snapshot.dispose();
  await assert.rejects(fs.stat(snapshot.path), { code: 'ENOENT' });
  store.set('request-1', url, null);
  assert.equal(await store.snapshot('request-1', url), null);
  store.set('request-1', url, { format: 'records', cookies: [{ ...data.cookies[0], domain: 'evil.example' }] });
  assert.equal(await store.snapshot('request-1', url), null);
});

test('companion asks its authenticated host once, coalesces preview/queue and tolerates denial', async t => {
  let reads = 0, deny = false, events = 0;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer token');
    if (req.url.endsWith('/host')) {
      reads++;
      res.writeHead(deny ? 403 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data.cookies));
    } else { events++; res.writeHead(200); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const manager = new CompanionManager();
  const callbackUrl = `http://127.0.0.1:${server.address().port}/v1/events/request-1`;
  manager.acceptDeepLink({ sourceUrl: url, companion: { callbackUrl, token: 'token', requestId: 'request-1' } });
  assert.equal(await manager.requestCookies('request-1', 'https://www.youtube.com/watch?v=other-id123'), null);
  const [first, second] = await Promise.all([manager.requestCookies('request-1', url), manager.requestCookies('request-1', url)]);
  assert.deepEqual(first, data); assert.deepEqual(second, data); assert.equal(reads, 1);
  deny = true;
  manager.acceptDeepLink({ sourceUrl: url, companion: { callbackUrl, token: 'token', requestId: 'request-2' } });
  assert.equal(await manager.requestCookies('request-2', url), null);
  assert.equal(reads, 2);
  for (let i = 0; events < 4 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(events, 4);
  manager.reportQueue([{ id: 'queue', companionRequestId: 'request-1', status: 'done', progress: 1 }]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(events, 4, 'Source handoffs do not subscribe to download progress by default');
  assert.deepEqual(await manager.requestCookies('request-1', url), data, 'Further edits keep the accepted request context');
});
