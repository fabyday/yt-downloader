const fs = require('node:fs');

function architectures(buffer, platform) {
  const cpu = value => ({ 0x01000007: 'x64', 0x0100000c: 'arm64' })[value];
  if (platform === 'win32') {
    if (buffer.toString('ascii', 0, 2) !== 'MZ') return [];
    const offset = buffer.readUInt32LE(0x3c);
    if (offset + 6 > buffer.length || buffer.toString('ascii', offset, offset + 4) !== 'PE\0\0') return [];
    return [{ 0x8664: 'x64', 0xaa64: 'arm64' }[buffer.readUInt16LE(offset + 4)]].filter(Boolean);
  }
  if (buffer.readUInt32LE(0) === 0xfeedfacf) return [cpu(buffer.readUInt32LE(4))].filter(Boolean);
  if (buffer.readUInt32BE(0) === 0xcafebabe) {
    const count = buffer.readUInt32BE(4);
    if (count > 16 || 8 + count * 20 > buffer.length) return [];
    return Array.from({ length: count }, (_, index) => cpu(buffer.readUInt32BE(8 + index * 20))).filter(Boolean);
  }
  return [];
}

function assertArchitecture(file, platform, arch) {
  const handle = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(4096);
    fs.readSync(handle, header, 0, header.length, 0);
    if (!architectures(header, platform).includes(arch)) throw new Error(`Binary architecture mismatch (${platform}-${arch}): ${file}`);
  } finally { fs.closeSync(handle); }
}
module.exports = { architectures, assertArchitecture };
