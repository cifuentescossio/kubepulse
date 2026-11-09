// Owner: A · Infra. Times follow docs/contracts.md: ISO 8601 with the Salt Lake City offset.
const test = require('node:test');
const assert = require('node:assert/strict');

const { formatStartTime, startedAt } = require('../telemetry');

test('formatStartTime uses the Salt Lake City offset (MST, -07:00)', () => {
  assert.equal(formatStartTime(new Date('2026-11-09T16:20:00Z')), '2026-11-09T09:20:00-07:00');
});

test('formatStartTime crosses midnight in local time, not UTC', () => {
  assert.equal(formatStartTime(new Date('2026-11-10T03:05:09Z')), '2026-11-09T20:05:09-07:00');
});

test('formatStartTime uses the daylight saving offset when applicable', () => {
  assert.equal(formatStartTime(new Date('2026-07-09T16:20:00Z')), '2026-07-09T10:20:00-06:00');
});

test('formatStartTime defaults to the process start time', () => {
  assert.ok(startedAt instanceof Date);
  assert.match(formatStartTime(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});
