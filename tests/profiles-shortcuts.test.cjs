require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { listBrowserProfiles, browserProfileRoots } = require('../src/Worker/BrowserProfiles.ts');
const { canonicalShortcut, shortcutFromEvent, isProtectedShortcut, platformShortcut } = require('../src/Shared/shortcuts.ts');

test('macOS Control and Command are distinct; save combinations are not blocked', () => {
  const event = {key:'s',code:'KeyS',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false};
  assert.equal(shortcutFromEvent(event,true),'Ctrl+S');
  assert.equal(shortcutFromEvent(event,false),'CmdOrCtrl+S');
  assert.equal(shortcutFromEvent({...event,ctrlKey:false,metaKey:true},true),'CmdOrCtrl+S');
  assert.equal(shortcutFromEvent({...event,metaKey:true},true),'CmdOrCtrl+Ctrl+S');
  assert.equal(canonicalShortcut('Shift+Ctrl+S'),'Ctrl+Shift+S');
  for (const key of ['Ctrl+S','CmdOrCtrl+S','F5']) for (const mac of [true,false]) assert.equal(isProtectedShortcut(key,mac),false);
  assert.equal(isProtectedShortcut('CmdOrCtrl+C',true),true);
  assert.equal(isProtectedShortcut('Ctrl+C',true),false);
  assert.equal(platformShortcut('Ctrl+S',false),platformShortcut('CmdOrCtrl+S',false));
  assert.notEqual(platformShortcut('Ctrl+S',true),platformShortcut('CmdOrCtrl+S',true));
});

test('profile discovery uses standard OS paths, profile metadata and directory names only', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kawai-profiles-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const context={platform:'darwin',home:dir,env:{}};
  const root=browserProfileRoots('chrome',context)[0];
  for (const name of ['Default','Profile 1','Unrelated','Bad:Profile']) await fs.mkdir(path.join(root,name),{recursive:true});
  await fs.writeFile(path.join(root,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Personal'},'Profile 1':{name:'Work'},'Bad:Profile':{name:'Ignore'}}}}));
  const result=await listBrowserProfiles({browser:'chrome'},context);
  assert.deepEqual(result,{supported:true,profiles:[{value:'Default',label:'Personal (Default)'},{value:'Profile 1',label:'Work (Profile 1)'}]});
  assert.deepEqual(await listBrowserProfiles({browser:'edge'},context),{supported:true,profiles:[]});
  for (const browser of ['safari','opera']) assert.deepEqual(await listBrowserProfiles({browser},context),{supported:false,profiles:[]});
  const firefox=browserProfileRoots('firefox',context)[0];
  await fs.mkdir(path.join(firefox,'abc.default-release'),{recursive:true});
  await fs.writeFile(path.join(firefox,'abc.default-release','cookies.sqlite'),'not a database; metadata listing must never open it');
  await fs.writeFile(path.join(firefox,'../profiles.ini'),'[Profile0]\nName=Editing\nIsRelative=1\nPath=Profiles/abc.default-release\n');
  assert.deepEqual((await listBrowserProfiles({browser:'firefox'},context)).profiles,[{value:'abc.default-release',label:'Editing (abc.default-release)'}]);
  await fs.writeFile(path.join(root,'Local State'),'malformed');
  assert.equal((await listBrowserProfiles({browser:'chrome'},context)).error,'cookies.profilesFailed');
  await assert.rejects(()=>listBrowserProfiles({browser:'not-a-browser'},context),/cookies.invalidBrowser/);
  assert.equal(browserProfileRoots('chrome',{platform:'win32',home:'C:\\Users\\test',env:{LOCALAPPDATA:'D:\\Local'}})[0],'D:\\Local\\Google\\Chrome\\User Data');
  assert.equal(browserProfileRoots('edge',{platform:'linux',home:'/home/test',env:{XDG_CONFIG_HOME:'/config'}})[0],'/config/microsoft-edge');
});
