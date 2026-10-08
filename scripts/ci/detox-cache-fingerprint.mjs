import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fingerprintDetoxBuildConfigs } from './detox-build-config-fingerprint.mjs';
import {
  detoxInputPathspecs,
  filterDetoxBuildInputPaths,
  hashCurrentInputs,
  hashInputGroups,
} from './detox-cache-inputs.mjs';

// Cache app products by their source and builder inputs; CI-only reuse policy does not affect bytes.
const BUILD_INPUT_PATHS = [
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/mobile',
  'packages',
  'scripts/ci/build-detox-apps.sh',
  'scripts/ci/build-ios-simulator-app.sh',
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
  'scripts/ci/build-ios-simulator-app.sh',
];

export function listChangedDetoxBuildInputs(repositoryRoot = process.cwd()) {
  const pathspecs = detoxInputPathspecs(BUILD_INPUT_PATHS);
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
      ...pathspecs,
    ],
    { encoding: 'buffer' },
  );
  const untracked = execFileSync(
    'git',
    ['-C', repositoryRoot, 'ls-files', '-z', '--others', '--exclude-standard', '--', ...pathspecs],
    { encoding: 'buffer' },
  );
  const paths = Buffer.concat([output, untracked]).toString('utf8').split('\0').filter(Boolean);
  return filterDetoxBuildInputPaths(paths);
}

function addBuildConfigFingerprint(trackedInputs, repositoryRoot) {
  const buildConfigs = fingerprintDetoxBuildConfigs(repositoryRoot);
  const hash = createHash('sha256');
  hash.update(trackedInputs.fingerprint);
  hash.update('\0');
  hash.update(JSON.stringify(buildConfigs));
  return { fingerprint: hash.digest('hex'), count: trackedInputs.count + buildConfigs.length };
}

export function computeDetoxCacheFingerprints(
  repositoryRoot = process.cwd(),
  options = {},
  readInput = readFileSync,
) {
  const root = resolve(repositoryRoot);
  const inputs = hashInputGroups(
    root,
    {
      buildInputs: { pathspecs: BUILD_INPUT_PATHS, excludeHostTests: true },
      reactNativeArtifacts: { pathspecs: REACT_NATIVE_ARTIFACT_PATHS },
      nativeDependencies: { pathspecs: NATIVE_DEPENDENCY_INPUT_PATHS },
    },
    options,
    readInput,
  );
  const nativeDependencies = addBuildConfigFingerprint(inputs.nativeDependencies, root);
  return makeFingerprintOutput({
    buildInputs: inputs.buildInputs,
    reactNativeArtifacts: inputs.reactNativeArtifacts,
    nativeDependencies,
    privacyManifestInputHash: inputs.buildInputs.privacyManifestInputHash,
    cocoapodsProjectInputHash: inputs.buildInputs.cocoapodsProjectInputHash,
  });
}

export function computeDetoxReactNativeArtifactFingerprint(
  repositoryRoot = process.cwd(),
  readInput = readFileSync,
) {
  const artifacts = hashCurrentInputs(
    resolve(repositoryRoot),
    REACT_NATIVE_ARTIFACT_PATHS,
    {},
    false,
    readInput,
  );
  return makeFingerprintOutput({ reactNativeArtifacts: artifacts });
}

export function computeDetoxDerivedDataFingerprints(
  repositoryRoot = process.cwd(),
  options = {},
  readInput = readFileSync,
) {
  const root = resolve(repositoryRoot);
  const inputs = hashInputGroups(
    root,
    {
      buildInputs: { pathspecs: BUILD_INPUT_PATHS, excludeHostTests: true },
      nativeDependencies: { pathspecs: NATIVE_DEPENDENCY_INPUT_PATHS },
    },
    options,
    readInput,
  );
  const nativeDependencies = addBuildConfigFingerprint(inputs.nativeDependencies, root);
  return makeFingerprintOutput({
    buildInputs: inputs.buildInputs,
    nativeDependencies,
    privacyManifestInputHash: inputs.buildInputs.privacyManifestInputHash,
    cocoapodsProjectInputHash: inputs.buildInputs.cocoapodsProjectInputHash,
  });
}

function makeFingerprintOutput({
  buildInputs,
  reactNativeArtifacts,
  nativeDependencies,
  privacyManifestInputHash,
  cocoapodsProjectInputHash,
}) {
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
  if (privacyManifestInputHash) fingerprints.privacyManifestInputHash = privacyManifestInputHash;
  if (cocoapodsProjectInputHash) fingerprints.cocoapodsProjectInputHash = cocoapodsProjectInputHash;
  return fingerprints;
}

export { hashCurrentInputs };
