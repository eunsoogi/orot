module.exports = Object.freeze([
  './smoke.test.js',
  // Keep first-use probes ahead of routes that write shared app state.
  './appointments.test.js',
  './agentMemory.test.js',
  './graph.test.js',
  './checkpoint.detox.e2e.js',
  './storage.test.js',
]);
