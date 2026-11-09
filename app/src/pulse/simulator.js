// Owner: C · Pulso. In-memory room-occupancy simulator.
// One timer (unref'd) ticks every 5 s: a bounded random walk toward a target that
// rises at the start of each talk slot. Each room keeps 30 min of history in a
// fixed-size ring buffer, so memory stays constant no matter how long the pod runs.

const SLC_OFFSET_MS = -7 * 60 * 60 * 1000; // docs/contracts.md: always -07:00
const MIN_OCC = 0.03;
const MAX_OCC = 0.99;
const TREND_LOOKBACK_MS = 30 * 1000;
const TREND_THRESHOLD = 0.015;

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

class Ring {
  constructor(size) {
    this.t = new Float64Array(size);
    this.v = new Float64Array(size);
    this.size = size;
    this.start = 0;
    this.count = 0;
  }

  push(t, v) {
    const i = (this.start + this.count) % this.size;
    this.t[i] = t;
    this.v[i] = v;
    if (this.count < this.size) this.count++;
    else this.start = (this.start + 1) % this.size;
  }

  // Oldest → newest, only points with t >= since.
  since(since) {
    const out = [];
    for (let k = 0; k < this.count; k++) {
      const i = (this.start + k) % this.size;
      if (this.t[i] >= since) out.push({ t: this.t[i], v: this.v[i] });
    }
    return out;
  }

  // Most recent value at or before `t`, or the oldest one we have.
  valueAtOrBefore(t) {
    for (let k = this.count - 1; k >= 0; k--) {
      const i = (this.start + k) % this.size;
      if (this.t[i] <= t) return this.v[i];
    }
    return this.count ? this.v[this.start] : undefined;
  }
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
    random = Math.random,
  } = opts;
  if (!Array.isArray(rooms) || rooms.length === 0) throw new Error('simulator needs at least one room');

  const bufSize = Math.ceil(historyMs / tickMs) + 1;
  const state = new Map();
  rooms.forEach((room, idx) => {
    // Bigger, earlier-listed rooms draw a little more of the slot surge.
    const popularity = clamp(1 - idx * 0.08, 0.6, 1);
    const base = 0.25 + random() * 0.2;
    state.set(room.id, { room, popularity, base, occ: base, ring: new Ring(bufSize) });
  });

  let chaos = null; // { roomId, startedAt, until }
  let updatedAt = 0;
  let timer = null;

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

  function noise(amplitude) {
    return (random() * 2 - 1) * amplitude;
  }

  function chaosActive(ms = now()) {
    return Boolean(chaos && ms < chaos.until);
  }

  function step(ms) {
    if (chaos && ms >= chaos.until) chaos = null;
    const surge = slotSurge(ms);
    for (const [id, s] of state) {
      s.base = clamp(s.base + noise(0.01), 0.15, 0.55);
      if (chaos && chaos.roomId === id) {
        // Pinned at or above the chaos level for its whole window.
        s.occ = clamp(chaosLevel + random() * 0.03, chaosLevel, MAX_OCC);
      } else {
        const target = clamp(s.base + surge * s.popularity, MIN_OCC, 0.93);
        s.occ = clamp(s.occ + (target - s.occ) * 0.15 + noise(0.02), MIN_OCC, MAX_OCC);
      }
      s.ring.push(ms, round3(s.occ));
    }
    updatedAt = ms;
  }

  // Backfill history so the 30-minute chart is full right after start-up.
  function prefill() {
    const end = now();
    for (let ms = end - (bufSize - 1) * tickMs; ms <= end; ms += tickMs) step(ms);
  }

  function trendOf(s) {
    const prev = s.ring.valueAtOrBefore(updatedAt - TREND_LOOKBACK_MS);
    if (prev === undefined) return 'flat';
    const d = s.occ - prev;
    if (d > TREND_THRESHOLD) return 'up';
    if (d < -TREND_THRESHOLD) return 'down';
    return 'flat';
  }

  const api = {
    rooms: () => rooms.map((r) => ({ ...r })),
    hasRoom: (id) => state.has(id),

    tick() {
      step(now());
    },

    start() {
      if (timer) return api;
      if (!updatedAt) prefill();
      timer = setInterval(() => api.tick(), tickMs);
      timer.unref();
      return api;
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    // Body of GET /pulse.
    snapshot() {
      if (!updatedAt) step(now());
      return {
        rooms: [...state.values()].map((s) => ({
          id: s.room.id,
          name: s.room.name,
          occupancy: round3(s.occ),
          capacity: s.room.capacity,
          trend: trendOf(s),
        })),
        updated_at: toSlcIso(updatedAt),
      };
    },

    // Body of GET /pulse/history?room=<id>, or null for an unknown room.
    history(roomId) {
      const s = state.get(roomId);
      if (!s) return null;
      if (!updatedAt) step(now());
      const points = s.ring.since(updatedAt - historyMs).map((p) => ({ t: toSlcIso(p.t), occupancy: p.v }));
      return { room: roomId, points };
    },

    // For the OTel gauge callback.
    current() {
      return [...state.values()].map((s) => ({ room: s.room, occupancy: round3(s.occ) }));
    },

    // Returns { ok: true, room, until } or { ok: false, reason: 'busy'|'unknown_room', ... }.
    triggerChaos(roomId) {
      const ms = now();
      if (chaosActive(ms)) return { ok: false, reason: 'busy', room: chaos.roomId, until: toSlcIso(chaos.until) };
      if (!state.has(roomId)) return { ok: false, reason: 'unknown_room' };
      chaos = { roomId, startedAt: ms, until: ms + chaosMs };
      step(ms); // reflect it in /pulse immediately, not on the next tick
      return { ok: true, room: roomId, until: toSlcIso(chaos.until) };
    },

    isChaosActive: () => chaosActive(),

    getChaosState() {
      const ms = now();
      if (!chaosActive(ms)) return { active: false, room: null, until: null, remaining_ms: 0 };
      return { active: true, room: chaos.roomId, until: toSlcIso(chaos.until), remaining_ms: chaos.until - ms };
    },

    clearChaos() {
      chaos = null;
    },
  };
  return api;
}

module.exports = { createSimulator, toSlcIso, slcMinuteOfDay };
