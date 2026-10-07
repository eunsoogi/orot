/* global beforeAll, device */

beforeAll(async () => {
  await device.clearKeychain();
});

for (const suiteFile of require('./release-e2e-suite-files.js')) {
  require(suiteFile);
}
