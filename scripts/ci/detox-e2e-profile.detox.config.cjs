const path = require('node:path');

const profileConfigs = {
  release: '../../apps/mobile/.detoxrc.js',
  'openai-provider': '../../apps/mobile/e2e/openai-provider.detox.config.js',
  transcription: '../../apps/mobile/e2e/transcription.detox.config.js',
};
const profile = process.env.OROT_DETOX_TEST_PROFILE;
const profileConfig = profileConfigs[profile];

if (!profileConfig) {
  throw new Error(`Unsupported OROT_DETOX_TEST_PROFILE: ${profile || '(missing)'}`);
}

const baseConfig = require(path.resolve(__dirname, profileConfig));

module.exports = {
  ...baseConfig,
  testRunner: {
    ...baseConfig.testRunner,
    args: {
      ...baseConfig.testRunner.args,
      config: path.join(__dirname, 'detox-e2e-profile.jest.config.cjs'),
    },
  },
};
