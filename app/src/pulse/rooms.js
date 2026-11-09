// Owner: C · Pulso. Rooms and talk-slot schedule for the occupancy simulator.
// Reads app/data/rooms.json (B · Datos) when present; otherwise falls back to the
// rooms listed in docs/contracts.md so /pulse works before the data lands.
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Fallback from docs/contracts.md. Capacities other than `ace` are placeholders.
const FALLBACK_ROOMS = [
  { id: 'ace', name: 'Grand Ballroom ACE', capacity: 1200, wheelchair_accessible: true },
  { id: 'gi', name: 'Grand Ballroom GI', capacity: 900, wheelchair_accessible: true },
  { id: 'r254', name: 'Room 254', capacity: 250, wheelchair_accessible: true },
  { id: 'r255ef', name: 'Room 255 EF', capacity: 400, wheelchair_accessible: true },
];

// Local (Salt Lake City) start times of talk slots, used when no talk data exists.
const FALLBACK_SLOTS = ['09:20', '10:00', '10:45', '11:20', '13:00', '13:45', '14:30', '15:15', '15:55', '16:35'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return null;
  }
}

function loadRooms() {
  const data = readJson('rooms.json');
  const list = Array.isArray(data) ? data : data && Array.isArray(data.rooms) ? data.rooms : null;
  if (list) {
    const rooms = list
      .filter((r) => r && typeof r.id === 'string' && r.id && typeof r.name === 'string')
      .map((r) => ({
        id: r.id,
        name: r.name,
        capacity: Number.isFinite(Number(r.capacity)) && Number(r.capacity) > 0 ? Number(r.capacity) : 300,
        wheelchair_accessible: r.wheelchair_accessible !== false,
      }));
    if (rooms.length) return rooms;
  }
  return FALLBACK_ROOMS.map((r) => ({ ...r }));
}

// Minutes after local midnight for each distinct talk start ("HH:MM" from the ISO string).
function loadSlotMinutes() {
  const data = readJson('talks.json');
  const talks = Array.isArray(data) ? data : data && Array.isArray(data.talks) ? data.talks : [];
  const fromTalks = talks
    .map((t) => t && typeof t.start === 'string' && /T(\d{2}):(\d{2})/.exec(t.start))
    .filter(Boolean)
    .map((m) => `${m[1]}:${m[2]}`);
  const hhmm = fromTalks.length ? fromTalks : FALLBACK_SLOTS;
  const minutes = [...new Set(hhmm)].map((s) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  });
  return minutes.sort((a, b) => a - b);
}

module.exports = { loadRooms, loadSlotMinutes, FALLBACK_ROOMS, FALLBACK_SLOTS };
