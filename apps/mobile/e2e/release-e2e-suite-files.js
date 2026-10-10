module.exports = Object.freeze([
  // Storage probes start on each phase's clean app before other cases open or mutate its database.
  './storage.test.js',
  './smoke.test.js',
  // Keep the Safe Area regression cases in every required Release E2E run.
  './safe-area.test.js',
  './storage-migration.test.js',
  // Keep first-use probes ahead of routes that write shared app state.
  './appointments.test.js',
  './medicalAppointmentClassification.test.js',
  './medicalAppointmentNavigation.test.js',
  './agentMemory.test.js',
  './graph.test.js',
  './checkpoint.detox.e2e.js',
]);
