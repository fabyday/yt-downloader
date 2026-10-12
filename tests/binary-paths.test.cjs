require('ts-node/register/transpile-only');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {managedBinaryPath}=require('../src/Shared/BinaryPaths.ts');
test('dev cache and packaged resources are CPU-specific and independent of the old directory',()=>{
  for(const platform of ['darwin','win32'])for(const arch of ['arm64','x64'])for(const name of ['yt-dlp','ffmpeg']){
    const options={platform,arch,appPath:path.resolve('fixture-app'),resourcesPath:path.resolve('fixture-resources')};
    const executable=name+(platform==='win32'?'.exe':'');
    assert.equal(managedBinaryPath({...options,packaged:false},name),path.join(options.appPath,'.cache/build-binaries',`${platform}-${arch}`,executable));
    assert.equal(managedBinaryPath({...options,packaged:true},name),path.join(options.resourcesPath,'binaries',`${platform}-${arch}`,executable));
  }
});
