const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');

/** Resolve an explicitly chosen host checkout; never guess a sibling repository. */
function connectionDirectory(checkout) {
  if (!checkout) throw new Error('Pass --kawaikara /path/to/kawaikara-checkout.');
  const root = path.resolve(checkout);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'kawaikara') throw new Error('Select the Kawaikara checkout containing package.json.');
  return path.join(root, 'tmp', 'development-connections');
}
module.exports = { connectionDirectory };
if (require.main === module) {
  try {
    const { values } = parseArgs({ options: { kawaikara: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
    if (values.help) {
      console.log('Usage: pnpm start:connected --kawaikara /path/to/kawaikara-checkout');
    } else {
      const directory = connectionDirectory(values.kawaikara);
      const pnpm = process.env.npm_execpath;
      if (!pnpm || !path.isAbsolute(pnpm)) throw new Error('Run this command through pnpm start:connected.');
      const child = spawn(process.execPath, [pnpm, 'start'], {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, KAWAIKARA_EXTERNAL_APP_CONNECTION_DIRECTORY: directory },
      });
      child.on('error', error => { console.error(error.message); process.exitCode = 1; });
      child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
