import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const BUILD_INPUT_PATHS = [
  '.github/workflows/ci.yml',
  '.github/workflows/detox-e2e-profile.yml',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/mobile',
  'packages',
  'scripts/ci/build-detox-apps.sh',
  'scripts/ci/detox-cache-fingerprint.mjs',
  'scripts/ci/detox-cache-fingerprint-cli.mjs',
  'scripts/ci/detox-derived-data-cache.mjs',
];

const REACT_NATIVE_ARTIFACT_PATHS = ['pnpm-lock.yaml', 'apps/mobile/ios/Podfile.lock'];

const NATIVE_DEPENDENCY_INPUT_PATHS = [
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/mobile/package.json',
  'apps/mobile/react-native.config.js',
  'apps/mobile/ios',
  'packages',
  'scripts/ci/build-detox-apps.sh',
];

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

const GENERATED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'pods',
  '.cache',
  'deriveddata',
  'coresimulator',
  'simulator',
  'keychains',
]);

function isGeneratedPath(path) {
  const segments = path.split('/');
  if (segments.some((segment) => GENERATED_DIRECTORY_NAMES.has(segment.toLowerCase()))) {
    return true;
  }
  const iosIndex = segments.indexOf('ios');
  const iosBuildDirectory = iosIndex >= 0 ? segments[iosIndex + 1] : undefined;
  return iosBuildDirectory !== undefined && /^build(?:-|$)/.test(iosBuildDirectory.toLowerCase());
}

function listTrackedInputs(repositoryRoot, pathspecs) {
  const output = execFileSync('git', ['-C', repositoryRoot, 'ls-files', '-z', '--', ...pathspecs], {
    encoding: 'buffer',
  });
  return output
    .toString('utf8')
    .split('\0')
    .filter((path) => path && !isGeneratedPath(path))
    .sort();
}

export function listChangedDetoxBuildInputs(repositoryRoot = process.cwd()) {
  const output = execFileSync(
    'git',
    [
      '-C',
      repositoryRoot,
      'diff',
      '--name-only',
      '--no-ext-diff',
      '-z',
      'HEAD',
      '--',
      ...BUILD_INPUT_PATHS,
    ],
    { encoding: 'buffer' },
  );
  return output
    .toString('utf8')
    .split('\0')
    .filter((path) => path && !isGeneratedPath(path))
    .sort();
}

function hashTrackedInputs(repositoryRoot, pathspecs) {
  const paths = listTrackedInputs(repositoryRoot, pathspecs);
  if (paths.length === 0)
    throw new Error(`No tracked Detox cache inputs matched: ${pathspecs.join(', ')}`);

  const hash = createHash('sha256');
  for (const path of paths) {
    const absolutePath = join(repositoryRoot, path);
    const stat = lstatSync(absolutePath);
    const contents = stat.isSymbolicLink()
      ? Buffer.from(`symlink:${readlinkSync(absolutePath)}`)
      : readFileSync(absolutePath);
    hash.update(path);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return { fingerprint: hash.digest('hex'), count: paths.length };
}

function describeDetoxBuildConfig(repositoryRoot, descriptor) {
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
      build: normalizeDetoxBuildCommand(app.build),
      configuration: buildConfiguration,
      simulatorType: config.devices?.simulator?.type,
    };
  } finally {
    if (previousDerivedDataPath === undefined) delete process.env[descriptor.derivedDataEnv];
    else process.env[descriptor.derivedDataEnv] = previousDerivedDataPath;
    if (previousSimulatorId === undefined) delete process.env[descriptor.simulatorEnv];
    else process.env[descriptor.simulatorEnv] = previousSimulatorId;
  }
}

function normalizeDetoxBuildCommand(command) {
  // Bundle routing and forced JS bundling change app outputs, not reusable Pods.
  // The full build fingerprint still tracks these values and rebuilds the app.
  return command
    .replace(/(?:^|\s)(?:ENTRY_FILE|FORCE_BUNDLING)=[^\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashNativeDependencyInputs(repositoryRoot) {
  const trackedInputs = hashTrackedInputs(repositoryRoot, NATIVE_DEPENDENCY_INPUT_PATHS);
  const buildConfigs = BUILD_CONFIGS.map((descriptor) =>
    describeDetoxBuildConfig(repositoryRoot, descriptor),
  );
  const hash = createHash('sha256');
  hash.update(trackedInputs.fingerprint);
  hash.update('\0');
  hash.update(JSON.stringify(buildConfigs));
  return { fingerprint: hash.digest('hex'), count: trackedInputs.count + BUILD_CONFIGS.length };
}

export function computeDetoxCacheFingerprints(repositoryRoot = process.cwd()) {
  const root = resolve(repositoryRoot);
  const buildInputs = hashTrackedInputs(root, BUILD_INPUT_PATHS);
  const reactNativeArtifacts = hashTrackedInputs(root, REACT_NATIVE_ARTIFACT_PATHS);
  const nativeDependencies = hashNativeDependencyInputs(root);
  return makeFingerprintOutput({ buildInputs, reactNativeArtifacts, nativeDependencies });
}

export function computeDetoxReactNativeArtifactFingerprint(repositoryRoot = process.cwd()) {
  const artifacts = hashTrackedInputs(resolve(repositoryRoot), REACT_NATIVE_ARTIFACT_PATHS);
  return makeFingerprintOutput({ reactNativeArtifacts: artifacts });
}

export function computeDetoxDerivedDataFingerprints(repositoryRoot = process.cwd()) {
  const root = resolve(repositoryRoot);
  const buildInputs = hashTrackedInputs(root, BUILD_INPUT_PATHS);
  const nativeDependencies = hashNativeDependencyInputs(root);
  return makeFingerprintOutput({ buildInputs, nativeDependencies });
}

function makeFingerprintOutput({ buildInputs, reactNativeArtifacts, nativeDependencies }) {
  const fingerprints = {};
  if (buildInputs) {
    fingerprints.buildInputs = buildInputs.fingerprint;
    fingerprints.buildInputCount = buildInputs.count;
  }
  if (reactNativeArtifacts) {
    fingerprints.reactNativeArtifacts = reactNativeArtifacts.fingerprint;
    fingerprints.reactNativeArtifactInputCount = reactNativeArtifacts.count;
  }
  if (nativeDependencies) {
    fingerprints.nativeDependencies = nativeDependencies.fingerprint;
    fingerprints.nativeDependencyInputCount = nativeDependencies.count;
  }
  return fingerprints;
}
