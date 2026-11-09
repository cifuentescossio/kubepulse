// Owner: C · Pulso. Observable gauge `room.occupancy` (ratio 0-1), per docs/contracts.md.
// @opentelemetry/api arrives with A · Infra; until then (or if it fails to load) this is a no-op.
// With the API but no SDK registered, the meter is OTel's own no-op, so nothing is exported.

function registerOccupancyGauge(simulator) {
  let api;
  try {
    api = require('@opentelemetry/api');
  } catch {
    return false;
  }
  try {
    const meter = api.metrics.getMeter('kubepulse.pulse');
    const gauge = meter.createObservableGauge('room.occupancy', {
      description: 'Simulated room occupancy as a ratio of capacity (0-1)',
      unit: '1',
    });
    gauge.addCallback((result) => {
      for (const { room, occupancy } of simulator.current()) {
        result.observe(occupancy, {
          'room.id': room.id,
          'room.name': room.name,
          'room.capacity': room.capacity,
        });
      }
    });
    return true;
  } catch (err) {
    console.warn(`pulse: room.occupancy gauge not registered: ${err.message}`);
    return false;
  }
}

module.exports = { registerOccupancyGauge };
