// Keep storage first on the UI worker and leave first-use data probes on its isolated worker.
module.exports = Object.freeze({
  'release-e2e.test.js': Object.freeze([
    './storage.test.js',
    './smoke.test.js',
    './settings.detox.e2e.js',
    './unified-import-navigation.e2e.js',
    './navigation-glass.e2e.js',
    './ai-feature-visit-questions.e2e.js',
    './safe-area.test.js',
    './safe-area-keyboard.test.js',
  ]),
  'release-e2e-data.test.js': Object.freeze([
    './appointments.test.js',
    './medicalAppointmentClassification.test.js',
    './medicalAppointmentNavigation.test.js',
    './agentMemory.test.js',
    './graph.test.js',
    './checkpoint.detox.e2e.js',
  ]),
});
