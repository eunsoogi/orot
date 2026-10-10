// Keep the Safe Area probes on a second fresh app phase while reusing the data worker Simulator.
module.exports = Object.freeze({
  'release-e2e.test.js': Object.freeze([
    './storage.test.js',
    './smoke.test.js',
  ]),
  'release-e2e-data.test.js': Object.freeze([
    './safe-area.test.js',
    './storage-migration.test.js',
    './appointments.test.js',
    './medicalAppointmentClassification.test.js',
    './agentMemory.test.js',
    './graph.test.js',
    './checkpoint.detox.e2e.js',
  ]),
});
