// Owner: C · Pulse. Deterministic room-occupancy simulator.
//
// occupancy(room, t) is a pure function of the room id and the 5-second tick floor(t / 5 s):
// a time-of-day curve, a surge at the start of each talk slot, and noise from a PRNG seeded by
// (room id, tick). Every pod with the same clock and the same chaos windows returns exactly the
// same numbers, so /pulse and /pulse/history agree across replicas. Nothing is stored per tick:
// history is recomputed, and memory stays constant.
//
// The only state is the list of chaos windows { roomId, start, until } (absolute ms). It is shared
// between pods by forwarding POST /chaos (see peers.js), and windows from the last 30 min are kept
// so the history chart still shows a spike after it ends.

const SLC_OFFSET_MS = -7 * 60 * 60 * 1000; // docs/contracts.md: always -07:00
const MIN_OCC = 0.03;
const MAX_OCC = 0.99;
const MAX_NORMAL_OCC = 0.93; // without chaos a room never reaches "high" by noise alone
const TREND_THRESHOLD = 0.004; // per tick; above the per-tick jitter (±0.002 → max diff 0.004)
const NOISE_KNOT_TICKS = 12; // smooth noise gets a new random knot every minute
const NOISE_AMPLITUDE = 0.06;
const JITTER_AMPLITUDE = 0.002;
const MAX_WINDOWS = 16;
const RACE_MS = 2000; // two chaos starts this close together count as a race between pods

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

// ISO 8601 in Salt Lake City time with an explicit offset, e.g. 2026-11-09T15:55:03-07:00.
function toSlcIso(ms) {
  return new Date(Math.floor(ms / 1000) * 1000 + SLC_OFFSET_MS).toISOString().slice(0, 19) + '-07:00';
}

function slcMinuteOfDay(ms) {
  const local = ms + SLC_OFFSET_MS;
  return (((local / 60000) % 1440) + 1440) % 1440;
}

// FNV-1a 32-bit hash of a string.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// First output of mulberry32 seeded with `seed`, in [0, 1).
function mulberry32(seed) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Deterministic uniform [0, 1) for any combination of parts, e.g. rand('ace', 'jitter', 123).
const rand = (...parts) => mulberry32(fnv1a(parts.join('|')));
const signed = (...parts) => rand(...parts) * 2 - 1;
const smoothstep = (x) => x * x * (3 - 2 * x);

// Smooth noise in [-1, 1]: random knots every NOISE_KNOT_TICKS ticks, smoothstep in between.
function valueNoise(roomId, salt, tick) {
  const knot = Math.floor(tick / NOISE_KNOT_TICKS);
  const frac = (tick - knot * NOISE_KNOT_TICKS) / NOISE_KNOT_TICKS;
  const a = signed(roomId, salt, knot);
  const b = signed(roomId, salt, knot + 1);
  return a + (b - a) * smoothstep(frac);
}

// Conference-day curve in Salt Lake City time: [hour, base occupancy].
const DAY_CURVE = [
  [0, 0.03], [7, 0.05], [8.5, 0.25], [10, 0.4], [12, 0.35], [12.5, 0.22],
  [13.5, 0.38], [16, 0.35], [17.5, 0.15], [19, 0.05], [24, 0.03],
];

function dayCurve(ms) {
  const hour = slcMinuteOfDay(ms) / 60;
  for (let i = 1; i < DAY_CURVE.length; i++) {
    const [h1, v1] = DAY_CURVE[i];
    const [h0, v0] = DAY_CURVE[i - 1];
    if (hour <= h1) return v0 + (v1 - v0) * smoothstep((hour - h0) / (h1 - h0));
  }
  return DAY_CURVE[0][1];
}

function createSimulator(opts) {
  const {
    rooms,
    slotMinutes = [],
    tickMs = 5000,
    historyMs = 30 * 60 * 1000,
    chaosMs = 3 * 60 * 1000,
    chaosLevel = 0.96,
    now = Date.now,
  } = opts;
  if (!Array.isArray(rooms) || rooms.length === 0) throw new Error('simulator needs at least one room');

  const historyPoints = Math.round(historyMs / tickMs); // 360 for 30 min at 5 s
  const byId = new Map();
  rooms.forEach((room, idx) => {
    // Bigger, earlier-listed rooms draw a little more of the slot surge.
    const popularity = clamp(1 - idx * 0.08, 0.6, 1);
    // Fixed per-room scale of the day curve, from the room id only.
    const scale = 0.8 + 0.4 * rand(room.id, 'scale');
    byId.set(room.id, { room, popularity, scale });
  });

  let windows = []; // chaos windows { roomId, start, until } in ms, oldest first

  const tickOf = (ms) => Math.floor(ms / tickMs);

  // Extra target occupancy from the talk slot that started most recently (0 between slots).
  function slotSurge(ms) {
    const minute = slcMinuteOfDay(ms);
    let since = Infinity;
    for (const s of slotMinutes) {
      const d = minute - s;
      if (d >= 0 && d < since) since = d;
    }
    if (since === Infinity || since >= 30) return 0;
    if (since < 3) return 0.45 * (since / 3); // people walking in
    return 0.45 * Math.exp(-(since - 3) / 15); // settles, some leave
  }

  // A chaos window pins a tick when it overlaps any part of it, so /pulse shows a new chaos at once.
  function chaosAt(roomId, tick) {
    const t0 = tick * tickMs;
    const t1 = t0 + tickMs;
    return windows.some((w) => w.roomId === roomId && w.start < t1 && w.until > t0);
  }

  // The pure function: occupancy of a room at a tick, rounded to 3 decimals.
  function occupancyAtTick(roomId, tick) {
    const s = byId.get(roomId);
    if (!s) return undefined;
    if (chaosAt(roomId, tick)) {
      const wobble = (valueNoise(roomId, 'chaos', tick) + 1) / 2; // [0, 1], slow
      return round3(clamp(chaosLevel + 0.005 + 0.02 * wobble, chaosLevel, MAX_OCC));
    }
    const t = tick * tickMs;
    const v =
      dayCurve(t) * s.scale +
      slotSurge(t) * s.popularity +
      NOISE_AMPLITUDE * valueNoise(roomId, 'noise', tick) +
      JITTER_AMPLITUDE * signed(roomId, 'jitter', tick);
    return round3(clamp(v, MIN_OCC, MAX_NORMAL_OCC));
  }

  function trendAt(roomId, tick) {
    const d = occupancyAtTick(roomId, tick) - occupancyAtTick(roomId, tick - 1);
    if (d > TREND_THRESHOLD) return 'up';
    if (d < -TREND_THRESHOLD) return 'down';
    return 'flat';
  }

  function prune(ms) {
    windows = windows.filter((w) => w.until > ms - historyMs - tickMs);
    // Normal use adds at most one window per 3 min (10 in 30 min); keep a hard cap anyway.
    if (windows.length > MAX_WINDOWS) windows = windows.slice(-MAX_WINDOWS);
  }

  function activeWindow(ms) {
    return windows.find((w) => w.start <= ms && ms < w.until) || null;
  }

  // Deterministic winner when two pods started different chaos at once: earliest start, then room id.
  const wins = (a, b) => a.start < b.start || (a.start === b.start && a.roomId < b.roomId);

  const api = {
    rooms: () => rooms.map((r) => ({ ...r })),
    hasRoom: (id) => byId.has(id),

    // occupancy(room, t): same input, same output, on every pod.
    occupancy: (roomId, ms = now()) => occupancyAtTick(roomId, tickOf(ms)),

    // Kept for callers that started the old interval-based simulator; nothing to schedule now.
    start: () => api,
    stop() {},

    // Body of GET /pulse.
    snapshot() {
      const tick = tickOf(now());
      return {
        rooms: rooms.map((room) => ({
          id: room.id,
          name: room.name,
          occupancy: occupancyAtTick(room.id, tick),
          capacity: room.capacity,
          trend: trendAt(room.id, tick),
        })),
        updated_at: toSlcIso(tick * tickMs),
      };
    },

    // Body of GET /pulse/history?room=<id>: the last 360 ticks, oldest first, or null for an unknown room.
    history(roomId) {
      if (!byId.has(roomId)) return null;
      const last = tickOf(now());
      const points = [];
      for (let tick = last - historyPoints + 1; tick <= last; tick++) {
        points.push({ t: toSlcIso(tick * tickMs), occupancy: occupancyAtTick(roomId, tick) });
      }
      return { room: roomId, points };
    },

    // For the OTel gauge callback: the same function as /pulse.
    current() {
      const tick = tickOf(now());
      return rooms.map((room) => ({ room, occupancy: occupancyAtTick(room.id, tick) }));
    },

    // Local POST /chaos. Returns { ok: true, room, start, until } (ISO) or
    // { ok: false, reason: 'busy'|'unknown_room', ... }.
    triggerChaos(roomId) {
      const ms = now();
      prune(ms);
      const active = activeWindow(ms);
      if (active) return { ok: false, reason: 'busy', room: active.roomId, until: toSlcIso(active.until) };
      if (!byId.has(roomId)) return { ok: false, reason: 'unknown_room' };
      // Whole seconds, so the ISO strings forwarded to peers round-trip exactly.
      const start = Math.floor(ms / 1000) * 1000;
      const w = { roomId, start, until: start + chaosMs };
      windows.push(w);
      return { ok: true, room: roomId, start: toSlcIso(w.start), until: toSlcIso(w.until) };
    },

    // Chaos forwarded by a peer, taken as is (start/until not recalculated).
    // Returns { ok: true, room, until } or { ok: false, reason: 'invalid'|'unknown_room'|'busy', ... }.
    applyChaos({ room, start, until }) {
      const ms = now();
      const s = typeof start === 'string' ? Date.parse(start) : NaN;
      const u = typeof until === 'string' ? Date.parse(until) : NaN;
      const badRoom = typeof room !== 'string' || !room;
      // Exactly one chaos length, still running, and not starting in the future.
      const badTimes = !Number.isFinite(s) || !Number.isFinite(u) || u - s !== chaosMs || u <= ms;
      if (badRoom || badTimes || s > ms + 5000) {
        return { ok: false, reason: 'invalid' };
      }
      if (!byId.has(room)) return { ok: false, reason: 'unknown_room' };
      prune(ms);
      const w = { roomId: room, start: s, until: u };
      if (windows.some((x) => x.roomId === w.roomId && x.start === w.start && x.until === w.until)) {
        return { ok: true, room, until: toSlcIso(u) }; // already have it
      }
      // Windows that overlap this one compete; keep only the deterministic winner. Replacing an
      // active window is only for a real race (both started within RACE_MS); otherwise first wins.
      const rivals = windows.filter((x) => x.start < w.until && x.until > w.start);
      const loser = rivals.find((x) => wins(x, w) || Math.abs(x.start - w.start) > RACE_MS);
      if (loser) return { ok: false, reason: 'busy', room: loser.roomId, until: toSlcIso(loser.until) };
      windows = windows.filter((x) => !rivals.includes(x));
      windows.push(w);
      windows.sort((a, b) => a.start - b.start);
      prune(ms);
      return { ok: true, room, until: toSlcIso(u) };
    },

    isChaosActive: () => Boolean(activeWindow(now())),

    getChaosState() {
      const ms = now();
      const w = activeWindow(ms);
      if (!w) return { active: false, room: null, until: null, remaining_ms: 0 };
      return { active: true, room: w.roomId, until: toSlcIso(w.until), remaining_ms: w.until - ms };
    },

    // Tests: forget every chaos window, including past ones.
    clearChaos() {
      windows = [];
    },
  };
  return api;
}

module.exports = { createSimulator, toSlcIso, slcMinuteOfDay, mulberry32, fnv1a };
