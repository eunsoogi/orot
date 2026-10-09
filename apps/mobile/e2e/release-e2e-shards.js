// Explicit shard runs keep fresh-storage/UI probes separate from stateful data probes.
module.exports = Object.freeze({
  'release-e2e.test.js': Object.freeze([
    './storage.test.js',
    './smoke.test.js',
    './safe-area.test.js',
  ]),
  'release-e2e-data.test.js': Object.freeze([
    './storage-migration.test.js',
    './appointments.test.js',
    './medicalAppointmentClassification.test.js',
    './agentMemory.test.js',
    './graph.test.js',
    './checkpoint.detox.e2e.js',
  ]),
});
