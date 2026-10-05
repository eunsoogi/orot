import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

const BUILD_CONFIGS = [
  {
    path: 'apps/mobile/.detoxrc.js',
    app: 'ios.release',
    configuration: 'ios.sim.release',
    derivedDataEnv: 'OROT_DETOX_RELEASE_DERIVED_DATA_PATH',
    simulatorEnv: 'OROT_DETOX_SIMULATOR_UDID',
    derivedDataPath: 'ios/build-detox-release',
  },
  {
    path: 'apps/mobile/e2e/openai-provider.detox.config.js',
    app: 'ios.openai-provider',
    configuration: 'ios.sim.debug.openai-provider',
    derivedDataEnv: 'OROT_OPENAI_PROVIDER_DERIVED_DATA_PATH',
    simulatorEnv: 'OROT_OPENAI_PROVIDER_SIMULATOR_UDID',
    derivedDataPath: 'ios/build-detox-openai-provider',
  },
];

function normalizeBuildCommand(command) {
  // Bundle routing affects the app product but not reusable native dependencies.
  return command
    .replace(/(?:^|\s)(?:ENTRY_FILE|FORCE_BUNDLING)=[^\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprintDetoxBuildConfigs(repositoryRoot) {
  return BUILD_CONFIGS.map((descriptor) => {
    const configPath = resolve(repositoryRoot, descriptor.path);
    const previousDerivedDataPath = process.env[descriptor.derivedDataEnv];
    const previousSimulatorId = process.env[descriptor.simulatorEnv];
    process.env[descriptor.derivedDataEnv] = descriptor.derivedDataPath;
    process.env[descriptor.simulatorEnv] = '';
    try {
      const resolvedConfigPath = require.resolve(configPath);
      delete require.cache[resolvedConfigPath];
      const config = require(resolvedConfigPath);
      const app = config.apps?.[descriptor.app];
      const buildConfiguration = config.configurations?.[descriptor.configuration];
      if (!app?.build || !app?.binaryPath || !buildConfiguration) {
        throw new Error(`Detox build configuration is incomplete: ${descriptor.path}`);
      }
      return {
        type: app.type,
        binaryPath: app.binaryPath,
        build: normalizeBuildCommand(app.build),
        configuration: buildConfiguration,
        simulatorType: config.devices?.simulator?.type,
      };
    } finally {
      if (previousDerivedDataPath === undefined) delete process.env[descriptor.derivedDataEnv];
      else process.env[descriptor.derivedDataEnv] = previousDerivedDataPath;
      if (previousSimulatorId === undefined) delete process.env[descriptor.simulatorEnv];
      else process.env[descriptor.simulatorEnv] = previousSimulatorId;
    }
  });
}
