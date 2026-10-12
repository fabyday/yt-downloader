const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { requestCookieKeychainAccess, macAppBundleForExecutable } = require('../src/Main/CookiePermission.ts');

test('development permissions resolve the executable bundle, not the project directory', () => {
  assert.equal(macAppBundleForExecutable('/project/node_modules/.pnpm/electron/dist/Electron.app/Contents/MacOS/Electron'), '/project/node_modules/.pnpm/electron/dist/Electron.app');
  assert.equal(macAppBundleForExecutable('/Applications/kawai-downloader.app/Contents/MacOS/kawai-downloader'), '/Applications/kawai-downloader.app');
  assert.equal(macAppBundleForExecutable('/usr/bin/node'), null);
});

test('Keychain request uses protected read without exposing secrets', { skip: process.platform !== 'darwin' }, async t => {
  let code = 0;
  t.mock.method(childProcess, 'spawn', (command, args, options) => {
    assert.equal(command, '/usr/bin/security');
    assert.deepEqual(args, ['find-generic-password', '-w', '-a', 'Chrome', '-s', 'Chrome Safe Storage']);
    assert.equal(options.stdio, 'ignore');
    const child = new EventEmitter();
    process.nextTick(() => child.emit('close', code));
    return child;
  });
  await requestCookieKeychainAccess({ browser: 'chrome' });
  code = 44;
  await assert.rejects(requestCookieKeychainAccess({ browser: 'chrome' }), /cookies.keychainMissing/);
  code = 1;
  await assert.rejects(requestCookieKeychainAccess({ browser: 'chrome' }), /cookies.keychainAccessFailed/);
  await assert.rejects(requestCookieKeychainAccess({ browser: 'firefox' }), /cookies.noKeychainRequest/);
  assert.throws(() => requestCookieKeychainAccess({ browser: 'invalid' }), /cookies.invalidBrowser/);
});
