const { test } = require('node:test');
const assert = require('node:assert/strict');
const { editMarker, sameSegment } = require('../src/Shared/markerRules.ts');
test('placement resets opposite edge only after crossing', () => {
  assert.deepEqual(editMarker('end', 5, 100, 20, 40, 'place'), { start: 0, end: 5 });
  assert.deepEqual(editMarker('start', 50, 100, 20, 40, 'place'), { start: 50, end: 100 });
  assert.deepEqual(editMarker('end', 20, 100, 20, 40, 'place'), { start: 20, end: 20 });
  assert.deepEqual(editMarker('start', 30, 100, 20, 40, 'place'), { start: 30, end: 40 });
});
test('drag pushes opposite edge, remains separable and stays inside video', () => {
  assert.deepEqual(editMarker('start', 50, 100, 20, 40, 'drag'), { start: 50, end: 50 });
  assert.deepEqual(editMarker('end', 5, 100, 20, 40, 'drag'), { start: 5, end: 5 });
  assert.deepEqual(editMarker('start', 45, 100, 50, 50, 'drag'), { start: 45, end: 50 });
  assert.deepEqual(editMarker('end', 60, 100, 50, 50, 'drag'), { start: 50, end: 60 });
  for (const kind of ['start','end']) for (const intent of ['place','drag']) for(const time of [-10,0,10,50,100,500,NaN]) {
    const range=editMarker(kind,time,100,20,40,intent);
    assert.ok(0<=range.start&&range.start<=range.end&&range.end<=100);
  }
});
test('duplicate definition uses displayed milliseconds, not partial overlaps', () => {
  assert.equal(sameSegment({start:1,end:5},{start:1.00000001,end:5.00000001}),true);
  assert.equal(sameSegment({start:1,end:5},{start:1,end:6}),false);
  assert.equal(sameSegment({start:1,end:5},{start:2,end:4}),false);
});
