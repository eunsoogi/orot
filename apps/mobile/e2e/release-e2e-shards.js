// Keep UI probes isolated from ordered data and storage tests with only two active Simulator apps.
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
    './storage.test.js',
  ]),
});
