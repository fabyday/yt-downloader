require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTimelineTicks } = require('../src/Renderer/TimelineScale.ts');

test('rulers cover minutes, hours and multi-day videos without truncation or excessive ticks', () => {
  for (const duration of [60, 3600, 12 * 3600, 100 * 3600, 365 * 86400]) {
    for (const width of [280, 640, 1440]) {
      for (const zoom of [1, 8, 64]) {
        const span = duration / zoom;
        const ticks = buildTimelineTicks({ start: duration - span, end: duration, span }, width, time => String(time));
        assert.ok(ticks.length < 100, `${duration}/${width}/${zoom}: bounded density`);
        assert.equal(ticks.at(-1).left, '100%');
        assert.equal(ticks.at(-1).label, String(duration));
        assert.equal(ticks.at(-1).align, 'end');
        assert.ok(ticks.every(tick => parseFloat(tick.left) >= 0 && parseFloat(tick.left) <= 100));
      }
    }
  }
});
