// Explicit shards isolate fresh-storage, Safe Area, and stateful data probes.
module.exports = Object.freeze({
  'release-e2e.test.js': Object.freeze([
    './storage.test.js',
    './smoke.test.js',
  ]),
  'release-e2e-safe-area.test.js': Object.freeze(['./safe-area.test.js']),
  'release-e2e-data.test.js': Object.freeze([
    './storage-migration.test.js',
    './appointments.test.js',
    './medicalAppointmentClassification.test.js',
    './agentMemory.test.js',
    './graph.test.js',
    './checkpoint.detox.e2e.js',
  ]),
});
