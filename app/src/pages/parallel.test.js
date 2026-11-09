// Tests for the parallel-talk helpers in app/public/js/common.js (pickParallel, rankByOccupancy),
// loaded in a VM with a minimal browser stub. No network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadKP() {
  const attrs = { lang: 'en' };
  const root = { getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; } };
  const document = {
    readyState: 'complete', documentElement: root, body: null,
    querySelector: () => null, querySelectorAll: () => [], dispatchEvent: () => true,
    addEventListener: () => {}, createElement: () => ({ setAttribute() {}, appendChild() {} })
  };
  const window = {};
  const ctx = {
    window, document, location: { search: '' },
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => Promise.reject(new Error('offline')),
    CustomEvent: function CustomEvent() {}, Intl, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8'), ctx);
  return window.KP;
}

const KP = loadKP();
// Arrays built inside the VM have another prototype: compare plain copies.
const ids = (list, f = (x) => x.id) => Array.from(list, f);
const room = (id) => ({ id, name: id.toUpperCase() });
const slot = () => ({
  id: 'a', title: 'A', speakers: ['x'], start: '2026-11-09T09:20:00-07:00', end: '2026-11-09T09:45:00-07:00',
  room: room('ace'), topics: ['MCP'], match_reason: ['MCP'], forecast: 'high',
  parallel_alternative: { id: 'b', title: 'B', room: room('gi') },
  parallel_matches: [
    { id: 'b', title: 'B', speakers: ['y'], start: '2026-11-09T09:20:00-07:00', end: '2026-11-09T09:40:00-07:00',
      room: room('gi'), topics: ['Agentes'], match_reason: ['Agentes'], forecast: 'mid' },
    { id: 'c', title: 'C', speakers: ['z'], start: '2026-11-09T09:20:00-07:00', end: '2026-11-09T09:45:00-07:00',
      room: room('r254'), topics: ['MCP'], match_reason: ['MCP'], forecast: 'low' }
  ]
});

test('pickParallel puts the chosen match in the slot and keeps the previous one as an option', () => {
  const after = KP.pickParallel(slot(), 'c');
  assert.equal(after.id, 'c');
  assert.equal(after.room.id, 'r254');
  assert.deepEqual(ids(after.parallel_matches), ['a', 'b']);
  assert.equal(after.parallel_alternative.id, 'a');
  assert.equal(after.swapped, true);
  const back = KP.pickParallel(after, 'a');
  assert.equal(back.id, 'a');
  assert.equal(back.swapped, false);
  assert.deepEqual(ids(back.parallel_matches).sort(), ['b', 'c']);
});

test('pickParallel uses the match times when it has them', () => {
  const after = KP.pickParallel(slot(), 'b');
  assert.equal(after.end, '2026-11-09T09:40:00-07:00');
});

test('legacy agenda without parallel_matches still swaps with parallel_alternative', () => {
  const old = slot();
  delete old.parallel_matches;
  const after = KP.swapTalk(old);
  assert.equal(after.id, 'b');
  assert.equal(after.start, old.start, 'inherits the slot time');
  assert.equal(after.parallel_matches, undefined);
  assert.equal(KP.swapTalk(after).id, 'a');
  assert.equal(KP.pickParallel(old, 'nope'), old);
});

test('empty parallel_matches: a non-matching parallel_alternative can still be picked', () => {
  const s = slot();
  s.parallel_matches = [];
  s.parallel_alternative = { id: 'x', title: 'X', room: room('r255ef') };
  const after = KP.pickParallel(s, 'x');
  assert.equal(after.id, 'x');
  assert.equal(after.start, s.start);
  assert.deepEqual(ids(after.parallel_matches), ['a'], 'the previous pick (which matches) becomes an option');
  assert.equal(KP.swapTalk(s).id, 'x');
});

test('rankByOccupancy orders matches by live occupancy and marks the least crowded', () => {
  const occ = { ace: 0.96, gi: 0.6, r254: 0.2 };
  const ranked = KP.rankByOccupancy(slot(), (id) => (id in occ ? occ[id] : null));
  assert.deepEqual(ids(ranked.options, (o) => o.talk.id), ['a', 'c', 'b']);
  assert.equal(ranked.options[0].recommended, true);
  assert.equal(ranked.leastId, 'c');
});

test('rankByOccupancy keeps backend order without live data and labels nothing', () => {
  const ranked = KP.rankByOccupancy(slot(), () => null);
  assert.deepEqual(ids(ranked.options, (o) => o.talk.id), ['a', 'b', 'c']);
  assert.equal(ranked.leastId, null);
});

test('the recommended talk can be the least crowded', () => {
  const occ = { ace: 0.1, gi: 0.6 };
  const ranked = KP.rankByOccupancy(slot(), (id) => (id in occ ? occ[id] : null));
  assert.equal(ranked.leastId, 'a');
  assert.deepEqual(ids(ranked.options, (o) => o.talk.id), ['a', 'b', 'c'], 'unknown rooms go last');
});

test('i18n: every key exists in the 5 languages', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/i18n.json'), 'utf8'));
  const en = Object.keys(dict.en).sort();
  for (const l of ['zh', 'hi', 'es', 'fr']) assert.deepEqual(Object.keys(dict[l]).sort(), en, l);
  for (const k of ['agenda.matches', 'agenda.pick', 'agenda.least', 'agenda.suggested', 'agenda.live.least']) {
    assert.ok(en.includes(k), k);
  }
});

test('sample agenda has parallel_matches with ISO 8601 times and a -07:00 offset', () => {
  const agenda = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/mock/agenda.json'), 'utf8'));
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-07:00$/;
  let n = 0;
  for (const talk of agenda.talks) {
    assert.ok(Array.isArray(talk.parallel_matches), talk.id);
    for (const m of talk.parallel_matches) {
      n += 1;
      assert.match(m.start, iso);
      assert.match(m.end, iso);
      assert.ok(m.match_reason.length > 0, m.id);
      assert.ok(m.room && m.room.id, m.id);
    }
  }
  assert.ok(n >= 6);
});
