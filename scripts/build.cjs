const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkUi } = require('./check-ui.cjs');
const { assertArchitecture } = require('./binary-architecture.cjs');
const root = path.resolve(__dirname, '..');

function parseOptions(args, host = process.platform, arch = process.arch) {
  const options = { platform: host, arch, dir: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dir') options.dir = true;
    else if (arg === '--platform' || arg === '--arch') options[arg.slice(2)] = args[++index];
    else throw new Error(`Unknown build option: ${arg}`);
  }
  if (!['win32', 'darwin'].includes(options.platform)) throw new Error('Supported build platforms: win32, darwin');
  if (!['x64', 'arm64'].includes(options.arch)) {
    throw new Error('Supported targets: win32-x64, win32-arm64, darwin-x64, darwin-arm64');
  }
  if (options.platform !== host) throw new Error(`Build ${options.platform} on its native OS, or use the GitHub Actions matrix.`);
  return options;
}

function verifyBinaries(options, directory) {
  const suffix = options.platform === 'win32' ? '.exe' : '';
  for (const binary of ['yt-dlp', 'ffmpeg']) {
    const file = path.join(directory, binary + suffix);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size < 1024) throw new Error(`Missing/invalid bundled binary: ${file}`);
    if (options.platform === 'darwin') fs.accessSync(file, fs.constants.X_OK);
    assertArchitecture(file, options.platform, options.arch);
  }
}

function packageConfig(options) {
  return {
    directories: { output: `dist/${options.platform}-${options.arch}` },
    extraResources: [
      { from: `.cache/build-binaries/${options.platform}-${options.arch}`, to: `binaries/${options.platform}-${options.arch}` },
      { from: 'kawaikara-companion.json', to: 'kawaikara-companion.json' },
    ],
  };
}

function run(moduleName, args) {
  const result = spawnSync(process.execPath, [require.resolve(moduleName), ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${moduleName} failed (${result.signal || result.status})`);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  process.chdir(root);
  checkUi();
  const { prepareBinaries } = require('./prepare-binaries.cjs');
  const binaries = await prepareBinaries(options);
  verifyBinaries(options, binaries);
  console.log(`Building ${options.platform}-${options.arch}${options.dir ? ' application directory' : ' installers'} (publishing disabled)`);
  run('typescript/bin/tsc', ['--noEmit']);
  run('webpack/bin/webpack.js', ['--config', ...['Main', 'Preload', 'Renderer', 'Worker'].map(part => `src/${part}/webpack.prod.ts`)]);
  const { build, Platform, Arch } = require('electron-builder');
  const platform = options.platform === 'darwin' ? Platform.MAC : Platform.WINDOWS;
  await build({ projectDir: root, targets: platform.createTarget(options.dir ? ['dir'] : undefined, Arch[options.arch]),
    publish: 'never', config: { ...packageConfig(options), afterPack: async context => {
      const resources = options.platform === 'darwin'
        ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources')
        : path.join(context.appOutDir, 'resources');
      verifyBinaries(options, path.join(resources, 'binaries', `${options.platform}-${options.arch}`));
      if (!fs.existsSync(path.join(resources, 'app.asar'))) throw new Error('Packaged app.asar is missing');
      if (!fs.existsSync(path.join(resources, 'app.asar.unpacked/build/worker/yt-dlp-plugins/kawai/yt_dlp_plugins/extractor/kawai_chzzk.py'))) {
        throw new Error('Packaged CHZZK compatibility plugin is missing');
      }
      if (!fs.existsSync(path.join(resources, 'kawaikara-companion.json'))) throw new Error('Companion manifest is missing');
      if (process.arch === options.arch) {
        for (const name of ['yt-dlp', 'ffmpeg']) {
          const file = path.join(resources, 'binaries', `${options.platform}-${options.arch}`, name + (options.platform === 'win32' ? '.exe' : ''));
          const result = spawnSync(file, [name === 'ffmpeg' ? '-version' : '--version'], { encoding: 'utf8', timeout: 30000 });
          if (result.error || result.status !== 0) throw new Error(`Packaged ${name} cannot run: ${result.error || result.stderr}`);
          console.log(`Packaged ${name}: ${result.stdout.split('\n')[0]}`);
        }
      }
    } } });
  console.log(`Built app: ${path.join(root, packageConfig(options).directories.output)}`);
}

module.exports = { parseOptions, verifyBinaries, packageConfig };
if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
