require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NativePreview } = require('../src/Renderer/NativePreview.ts');
test('no playback before a presented frame; split audio waits for video; disposed events ignored', () => {
  const media = [];
  class Media extends EventTarget {
    constructor() {super();this.readyState=2;this.paused=true;this.currentTime=0;this.duration=10;this.videoWidth=640;this.videoHeight=360;media.push(this);}
    requestVideoFrameCallback(callback) {this.frame=callback;}
    play() {this.paused=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();}
    pause() {this.paused=true;}
    removeAttribute() {}
    load() {}
    replaceWith() {}
  }
  global.document = {createElement:()=>new Media(),getElementById:()=>({replaceWith(){}})};
  global.window = {setTimeout};
  global.Audio = Media;
  let ready=0,changes=0;
  const player = new NativePreview({ok:true,videoId:'fixture',title:'fixture',url:'https://media.googlevideo.com/video',audioUrl:'https://media.googlevideo.com/audio'},()=>ready++,()=>changes++,()=>assert.fail('Unexpected failure'));
  try {
    const [video,audio]=media;
    player.setVolume(0.4,true);
    assert.equal(video.volume,0.4); assert.equal(audio.volume,0.4);
    assert.equal(video.muted,true); assert.equal(audio.muted,true);
    video.dispatchEvent(new Event('loadeddata'));audio.dispatchEvent(new Event('loadeddata'));
    player.playVideo();video.dispatchEvent(new Event('playing'));
    assert.equal(ready,0);assert.equal(video.paused,true);assert.equal(video.muted,true);assert.equal(audio.paused,true);
    video.frame();assert.equal(ready,1);assert.equal(video.muted,true);
    player.setVolume(0.4,false); assert.equal(video.muted,false); assert.equal(audio.muted,false);
    player.playVideo();assert.equal(video.paused,false);assert.equal(audio.paused,false);
    video.currentTime=2; video.frame(0,{mediaTime:1.9});
    assert.equal(player.getCurrentTime(),1.9);
    video.currentTime=3; assert.equal(player.getCurrentTime(),1.9,'clock cannot run ahead of displayed frames');
    video.frame(0,{mediaTime:3}); assert.equal(player.getCurrentTime(),3);
    player.seekTo(8); video.seeking=true; video.dispatchEvent(new Event('seeking'));
    assert.equal(player.isSeeking(),true); assert.equal(audio.paused,true);
    player.seekTo(4); player.seekTo(6);
    assert.equal(video.currentTime,8,'active decoder seek is not interrupted');
    video.seeking=false; video.dispatchEvent(new Event('seeked'));
    assert.equal(video.currentTime,6,'only latest queued target is applied');
    video.dispatchEvent(new Event('seeked'));
    assert.equal(player.isSeeking(),false); assert.equal(audio.currentTime,6); assert.equal(audio.paused,false);
    player.pauseVideo();video.dispatchEvent(new Event('playing'));assert.equal(audio.paused,true);
    const beforeDestroy=changes;
    player.destroy();video.dispatchEvent(new Event('play'));assert.equal(changes,beforeDestroy);
  } finally {player.destroy();delete global.document;delete global.window;delete global.Audio;}
});
