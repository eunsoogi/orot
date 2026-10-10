module.exports = Object.freeze([
  './smoke.test.js',
  // Verify the native toolbar backdrop and reachability at accessibility text sizes.
  './navigation-glass.e2e.js',
  // Exercise the #109 screen through App navigation with synthetic route operations.
  './ai-feature-visit-questions.e2e.js',
  // Keep the Safe Area regression cases in every required Release E2E run.
  './safe-area.test.js',
  './safe-area-keyboard.test.js',
  // Keep first-use probes ahead of routes that write shared app state.
  './appointments.test.js',
  './medicalAppointmentClassification.test.js',
  './agentMemory.test.js',
  './graph.test.js',
  './checkpoint.detox.e2e.js',
  './storage.test.js',
]);
