require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nearestTimelineHandle, zoomViewportStart } = require('../src/Shared/timelineInteraction.ts');
const { normalizeAppPreferences } = require('../src/Shared/preferences.ts');
const { DEFAULT_SHORTCUTS } = require('../src/Shared/shortcuts.ts');

test('horizontal handle picking uses a pixel threshold and deterministic overlap ownership', () => {
  const handles=[{kind:'start',x:100},{kind:'end',x:200},{kind:'playhead',x:105}];
  assert.equal(nearestTimelineHandle(111, handles, null),'playhead');
  assert.equal(nearestTimelineHandle(100, handles, null),'start');
  assert.equal(nearestTimelineHandle(212, handles, null),'end');
  assert.equal(nearestTimelineHandle(213, handles, null),null);
  const overlapping=[{kind:'start',x:100},{kind:'end',x:100},{kind:'playhead',x:100}];
  assert.equal(nearestTimelineHandle(100, overlapping, 'end'),'end');
  assert.equal(nearestTimelineHandle(100, overlapping, null),'start');
});
test('zoom keeps visible pivots stationary and centers offscreen pivots within video bounds', () => {
  for(const pivot of [0,100,300,500,600]) {
    const start=zoomViewportStart(0,600,480,pivot,600);
    assert.ok(Math.abs((pivot-start)/480-pivot/600)<1e-9);
  }
  assert.equal(zoomViewportStart(0,100,80,500,600),460);
  assert.equal(zoomViewportStart(0,100,80,600,600),520);
});
test('playback preferences migrate, clamp and persist without shortcut conflicts', () => {
  const initial=normalizeAppPreferences({});
  assert.equal(initial.previewVolume,1); assert.equal(initial.previewMuted,false); assert.equal(initial.timelineZoomPivot,'playhead');
  const saved=normalizeAppPreferences({previewVolume:0.35,previewMuted:true,timelineZoomPivot:'end'});
  assert.deepEqual(normalizeAppPreferences(JSON.parse(JSON.stringify(saved))),saved);
  assert.equal(normalizeAppPreferences({previewVolume:3,timelineZoomPivot:'invalid'}).previewVolume,1);
  assert.equal(normalizeAppPreferences({previewVolume:-1,timelineZoomPivot:'invalid'}).timelineZoomPivot,'playhead');
  assert.equal(new Set(Object.values(DEFAULT_SHORTCUTS)).size,Object.values(DEFAULT_SHORTCUTS).length);
});
