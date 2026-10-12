const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let prepared = false;

// Tests and diagnostics use the same verified preparation as dev and packaging.
// No real browser credentials are accessed here. Explicit binary overrides remain supported.
function testBinary(name) {
  if (!['yt-dlp', 'ffmpeg'].includes(name)) throw new Error('Unknown binary');
  const override = process.env[name === 'yt-dlp' ? 'YT_DLP_PATH' : 'FFMPEG_PATH']?.trim();
  if (override) return override;
  if (!prepared) {
    execFileSync(process.execPath, [path.join(root, 'scripts/prepare-binaries.cjs')], {
      cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 600000,
    });
    prepared = true;
  }
  return path.join(root, '.cache/build-binaries', `${process.platform}-${process.arch}`,
    name + (process.platform === 'win32' ? '.exe' : ''));
}
module.exports = { testBinary };
