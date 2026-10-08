/* global beforeAll, device */

const {
  resetCheckpointContainer,
} = require('../test-support/checkpointStorageReset.js');

// Only the standalone profile loads this setup. The combined Release suite
// shares one SQLCipher container across its probe files.
beforeAll(async () => {
  await resetCheckpointContainer(device);
});
