const checkpointConfig = require('../e2e/checkpoint.jest.config.js');
const releaseConfig = require('../e2e/release-e2e.jest.config.js');
const { resetCheckpointContainer } = require('./checkpointStorageReset.js');

describe('checkpoint test container reset', () => {
  it('removes the database before clearing the Keychain and reinstalls the app', async () => {
    const events = [];
    const fakeDevice = {
      uninstallApp: async () => events.push('uninstall'),
      clearKeychain: async () => events.push('clear-keychain'),
      installApp: async () => events.push('install'),
    };

    await resetCheckpointContainer(fakeDevice);

    expect(events).toEqual(['uninstall', 'clear-keychain', 'install']);
  });

  it('registers the destructive reset only for the standalone checkpoint profile', () => {
    // The ordered Release suite retains one SQLCipher database across its probe files.
    expect(checkpointConfig.setupFilesAfterEnv).toContain(
      '<rootDir>/e2e/checkpointStandaloneSetup.js',
    );
    expect(releaseConfig.setupFilesAfterEnv ?? []).not.toContain(
      '<rootDir>/e2e/checkpointStandaloneSetup.js',
    );
  });
});
