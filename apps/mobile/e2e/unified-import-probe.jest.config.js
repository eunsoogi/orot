const probeMode = process.env.OROT_UNIFIED_IMPORT_PROBE_MODE;

// The case budget includes its inner Detox wait; the separate Detox setupTimeout
// only bounds suite setup and cannot extend an in-progress Jest test.
const testTimeout = probeMode === 'live' ? 660000 : 300000;

module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/e2e/unified-import-probe.detox.e2e.js'],
  testPathIgnorePatterns: [],
  testTimeout,
};
