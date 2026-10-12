require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { previewCookieDetails, applyPreviewCookies } = require('../src/Main/PreviewCookies.ts');
const contents = '# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\ttest\nwww.youtube.com\tFALSE\t/\tFALSE\t2000000000\tPREF\tx\n.google.com\tTRUE\t/\tTRUE\t0\tSID\tprivate-google\n';
test('preview credentials stay on YouTube, preserve host-only/HttpOnly, and support HTTPS embeds', () => {
  const result = previewCookieDetails(contents);
  assert.equal(result.length, 2);
  assert.equal(result[0].httpOnly, true);
  assert.equal(result[0].expirationDate, undefined);
  assert.equal(result[0].domain, '.youtube.com');
  assert.equal(result[1].domain, undefined);
  assert.equal(result[1].expirationDate, 2000000000);
  assert.ok(result.every(cookie => cookie.secure && cookie.sameSite === 'no_restriction'));
  assert.ok(result.every(cookie => new URL(cookie.url).hostname.endsWith('youtube.com')));
});
test('preview replacement clears old YouTube credentials, and clear removes auth without touching other sites', async () => {
  const removed = [], added = [];
  const target = { cookies: {
    get: async () => [{domain:'.youtube.com', path:'/', name:'OLD'}, {domain:'.example.com', path:'/', name:'KEEP'}],
    remove: async (...args) => removed.push(args), set: async details => added.push(details),
  }};
  assert.equal(await applyPreviewCookies(target, contents), 2);
  assert.deepEqual(removed, [['https://youtube.com/', 'OLD']]);
  assert.equal(await applyPreviewCookies(target, null), 0);
  assert.equal(added.length, 2);
  target.cookies.set = async () => { throw new Error('secret-value'); };
  await assert.rejects(applyPreviewCookies(target, contents), { message:'cookies.previewFailed' });
});
