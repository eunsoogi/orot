const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../..');
const mobileRoot = path.join(repositoryRoot, 'apps/mobile');
const profileConfigs = {
  release: 'e2e/release-e2e.jest.config.js',
  'openai-provider': 'e2e/openai-provider.jest.config.js',
};
const profile = process.env.OROT_DETOX_TEST_PROFILE;
const profileConfig = profileConfigs[profile];

if (!profileConfig) {
  throw new Error(`Unsupported OROT_DETOX_TEST_PROFILE: ${profile || '(missing)'}`);
}

const baseConfig = require(path.join(mobileRoot, profileConfig));

module.exports = {
  ...baseConfig,
  rootDir: mobileRoot,
  roots: [path.join(mobileRoot, 'e2e')],
  transform: {},
};
