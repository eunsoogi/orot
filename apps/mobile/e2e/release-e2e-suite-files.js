module.exports = Object.freeze([
  './smoke.test.js',
  // Keep the Safe Area regression cases in every required Release E2E run.
  './safe-area.test.js',
  // Keep first-use probes ahead of routes that write shared app state.
  './appointments.test.js',
  './medicalAppointmentClassification.test.js',
  './agentMemory.test.js',
  './graph.test.js',
  './checkpoint.detox.e2e.js',
  './storage.test.js',
]);
