// Each wrapper gets its own Detox worker Simulator; preserve the scenario order inside each shard.
module.exports = Object.freeze({
  'release-e2e.test.js': Object.freeze([
    './smoke.test.js',
    './safe-area.test.js',
  ]),
  'release-e2e-data.test.js': Object.freeze([
    './appointments.test.js',
    './medicalAppointmentClassification.test.js',
    './agentMemory.test.js',
    './graph.test.js',
    './checkpoint.detox.e2e.js',
  ]),
  'release-e2e-storage.test.js': Object.freeze(['./storage.test.js']),
});
