// Collect exact source, profile, build, and runner identity for artifact compatibility checks.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { getProfile } from './ios-derived-data-cache-paths.mjs';

export const MANIFEST_NAME = 'manifest.json';
export const ARCHIVE_NAME = 'profile-app.tar';
export const SCHEMA_VERSION = 2;

const profileContracts = {
  release: {
    configPath: 'apps/mobile/.detoxrc.js',
    appKey: 'ios.release',
    configurationName: 'ios.sim.release',
    entryPoint: 'e2e/e2eRouterEntry.tsx',
    nativeFlags: {
      developmentTeam: null,
      forceBundling: '1',
      codeSigningAllowed: 'YES',
      codeSigningIdentity: '-',
      architecture: '$(uname -m)',
      onlyActiveArchitecture: 'YES',
      simulatorEntitlements: null,
      otherSwiftFlags: null,
    },
  },
  transcription: {
    configPath: 'apps/mobile/e2e/transcription.detox.config.js',
    appKey: 'ios.speech-transcription',
    configurationName: 'ios.sim.release.transcription',
    entryPoint: 'e2e/transcriptionProbeEntry.tsx',
    nativeFlags: {
      developmentTeam: 'OROTSIM000',
      forceBundling: '1',
      codeSigningAllowed: 'YES',
      codeSigningIdentity: '-',
      architecture: '$(uname -m)',
      onlyActiveArchitecture: 'YES',
      simulatorEntitlements: 'OrotMobile/OrotMobile.simulator.entitlements',
      otherSwiftFlags: '$(inherited) -DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST',
    },
  },
};

export function fail(message) {
  throw new Error('Detox profile app artifact: ' + message);
}

function requireFromRepository(root) {
  return createRequire(join(root, 'apps/mobile/package.json'));
}

function requiredValue(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '') fail(name + ' is required.');
  return value.trim();
}

function requiredHash(environment, name) {
  const value = requiredValue(environment, name);
  if (!/^[a-f0-9]{64}$/.test(value)) fail(name + ' must be a SHA-256 hex value.');
  return value;
}

// Read the checked-in Detox profile so a fingerprint cannot silently cross app configurations.
export function loadProfileBuildSettings(repositoryRoot, profile) {
  const contract = profileContracts[profile];
  if (!contract) fail('unsupported artifact profile: ' + profile + '.');
  const profileConfig = getProfile(profile);
  const configPath = resolve(repositoryRoot, contract.configPath);
  const require = requireFromRepository(repositoryRoot);
  const resolvedConfigPath = require.resolve(configPath);
  delete require.cache[resolvedConfigPath];
  const config = require(resolvedConfigPath);
  const app = config.apps?.[contract.appKey];
  const appConfiguration = config.configurations?.[contract.configurationName];
  const expectedBinaryPath = relative(
    resolve(repositoryRoot, 'apps/mobile'),
    resolve(repositoryRoot, profileConfig.derivedDataPath, profileConfig.productPath),
  );
  if (!app?.build || !appConfiguration || app.binaryPath !== expectedBinaryPath) {
    fail('the current ' + profile + ' Detox app configuration is incomplete or incompatible.');
  }

  const capture = (pattern, label) => {
    const match = app.build.match(pattern);
    if (!match) fail('the ' + profile + ' build command is missing ' + label + '.');
    return match[1];
  };
  const captureOptional = (pattern) => app.build.match(pattern)?.[1] ?? null;
  const nativeFlags = {
    developmentTeam: captureOptional(/(?:^|\s)DEVELOPMENT_TEAM=([^\s]+)/),
    forceBundling: capture(/(?:^|\s)FORCE_BUNDLING=([^\s]+)/, 'FORCE_BUNDLING'),
    codeSigningAllowed: capture(/(?:^|\s)CODE_SIGNING_ALLOWED=([^\s]+)/, 'CODE_SIGNING_ALLOWED'),
    codeSigningIdentity: capture(/(?:^|\s)CODE_SIGN_IDENTITY=([^\s]+)/, 'CODE_SIGN_IDENTITY'),
    architecture: capture(/(?:^|\s)ARCHS="([^"]+)"/, 'ARCHS'),
    onlyActiveArchitecture: capture(/(?:^|\s)ONLY_ACTIVE_ARCH=([^\s]+)/, 'ONLY_ACTIVE_ARCH'),
    simulatorEntitlements: captureOptional(/(?:^|\s)OROT_SIMULATOR_ENTITLEMENTS=([^\s]+)/),
    otherSwiftFlags: captureOptional(/(?:^|\s)OTHER_SWIFT_FLAGS='([^']+)'/),
  };
  const configuration = capture(/(?:^|\s)-configuration\s+([^\s]+)/, 'Xcode configuration');
  const sdk = capture(/(?:^|\s)-sdk\s+([^\s]+)/, 'SDK');
  const destination = capture(/(?:^|\s)-destination\s+'([^']+)'/, 'Simulator destination');
  const entryPoint = capture(/(?:^|\s)ENTRY_FILE=([^\s]+)/, 'ENTRY_FILE');
  const flagsMatch = Object.entries(contract.nativeFlags).every(
    ([name, expected]) => nativeFlags[name] === expected,
  );
  if (
    configuration !== 'Release' ||
    sdk !== 'iphonesimulator' ||
    destination !== 'generic/platform=iOS Simulator' ||
    entryPoint !== contract.entryPoint ||
    !flagsMatch ||
    appConfiguration.device !== 'simulator' ||
    appConfiguration.app !== contract.appKey
  ) {
    fail('the ' + profile + ' profile, entry point, or native build flags changed.');
  }
  return {
    profile,
    configurationName: contract.configurationName,
    configuration,
    sdk,
    destination,
    binaryPath: app.binaryPath,
    appConfiguration,
    simulatorType: config.devices?.simulator?.type,
    entryPoint,
    nativeFlags,
    buildCommand: app.build,
  };
}

export function collectBuildContext(repositoryRoot, environment, profile) {
  if (!profileContracts[profile]) fail('unsupported artifact profile: ' + profile + '.');
  const runId = Number(requiredValue(environment, 'GITHUB_RUN_ID'));
  const runAttempt = Number(requiredValue(environment, 'GITHUB_RUN_ATTEMPT'));
  if (
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(runAttempt) ||
    runAttempt <= 0
  ) {
    fail('workflow run ID and attempt must be positive integers.');
  }
  const sourceSha = requiredValue(environment, 'GITHUB_SHA');
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) fail('GITHUB_SHA must be a commit SHA.');
  const checkedOutSha = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    env: environment,
  }).trim();
  if (checkedOutSha !== sourceSha) fail('GITHUB_SHA does not match the checked-out source commit.');

  const expectedXcode = requiredValue(environment, 'EXPECTED_XCODE_VERSION');
  const xcodeDetails = execFileSync('xcodebuild', ['-version'], {
    encoding: 'utf8',
    env: environment,
  });
  if (xcodeDetails.split(/\r?\n/)[0] !== 'Xcode ' + expectedXcode) {
    fail('the runner Xcode version does not match the expected version.');
  }
  const xcodeFingerprint = createHash('sha256').update(xcodeDetails).digest('hex');
  if (requiredHash(environment, 'XCODEBUILD_FINGERPRINT') !== xcodeFingerprint) {
    fail('the runner Xcode identity does not match the verified toolchain output.');
  }
  const expectedSdk = requiredValue(environment, 'EXPECTED_IOS_SIMULATOR_SDK');
  const actualSdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], {
    encoding: 'utf8',
    env: environment,
  }).trim();
  if (actualSdk !== expectedSdk)
    fail('the runner Simulator SDK does not match the expected version.');

  const platform = execFileSync('uname', ['-s'], { encoding: 'utf8', env: environment }).trim();
  const architecture = execFileSync('uname', ['-m'], { encoding: 'utf8', env: environment }).trim();
  const nodeArchitecture = process.arch === 'x64' ? 'x86_64' : process.arch;
  if (
    platform !== 'Darwin' ||
    requiredValue(environment, 'DETOX_CACHE_RUNNER_OS') !== 'macOS' ||
    architecture !== nodeArchitecture ||
    requiredValue(environment, 'DETOX_CACHE_RUNNER_ARCH').toLowerCase() !==
      architecture.toLowerCase()
  ) {
    fail('the producer and consumer must use the same supported macOS architecture.');
  }

  return {
    workflow: { runId, runAttempt, sourceSha },
    profile,
    fingerprints: {
      buildInputs: requiredHash(environment, 'EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT'),
      nativeDependencies: requiredHash(environment, 'EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT'),
    },
    runner: {
      platform,
      macOSVersion: execFileSync('sw_vers', ['-productVersion'], {
        encoding: 'utf8',
        env: environment,
      }).trim(),
      architecture,
      nodeArchitecture,
    },
    xcode: {
      developerDirectory: requiredValue(environment, 'DEVELOPER_DIR'),
      expectedVersion: expectedXcode,
      details: xcodeDetails,
      fingerprint: xcodeFingerprint,
    },
    simulatorSdk: actualSdk,
    build: loadProfileBuildSettings(repositoryRoot, profile),
  };
}

// Artifact exchange is meaningful only in the workflow that supplies this run identity.
export function requireActions(environment) {
  if (environment.GITHUB_ACTIONS !== 'true') fail('producer and consumer commands are CI-only.');
}

export function appendOutputs(environment, values) {
  const outputPath = environment.GITHUB_OUTPUT;
  if (!outputPath) return;
  writeFileSync(
    outputPath,
    Object.entries(values)
      .map(([name, value]) => name + '=' + value)
      .join('\n') + '\n',
    { flag: 'a' },
  );
}
