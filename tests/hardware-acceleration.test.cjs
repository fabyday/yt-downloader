const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHardwareAccelerationPreference } = require('../src/Main/HardwareAcceleration.ts');
const { normalizeAppPreferences } = require('../src/Shared/preferences.ts');

test('startup defaults to GPU on and honors saved boolean preferences on subsequent launches', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-gpu-test-'));
  const filename = path.join(directory, 'preferences.json');
  try {
    assert.equal(readHardwareAccelerationPreference(directory), true);
    for (const contents of ['{}', 'null', '{invalid', '{"hardwareAcceleration":"false"}']) {
      fs.writeFileSync(filename, contents);
      assert.equal(readHardwareAccelerationPreference(directory), true);
    }
    for (const hardwareAcceleration of [false, true]) {
      const preferences = normalizeAppPreferences({ hardwareAcceleration });
      fs.writeFileSync(filename, JSON.stringify(preferences));
      assert.equal(readHardwareAccelerationPreference(directory), hardwareAcceleration);
      assert.equal(normalizeAppPreferences({ locale: 'en' }, preferences).hardwareAcceleration, hardwareAcceleration);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
