import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fingerprintDetoxBuildConfigs } from './detox-build-config-fingerprint.mjs';

// The app-output fingerprint tracks source, configuration, and the real builder; CI/cache tooling only affects reuse policy.
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
// CocoaPods aggregates this tracked plist and adds generated pod integration to the project during install.
const PRIVACY_MANIFEST_INPUT = 'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy';
const COCOAPODS_PROJECT_INPUT = 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

function readInputPaths(output) {
  return output.toString('utf8').split('\0').filter(Boolean);
}

function filterInputPaths(paths) {
  return [...new Set(paths)].filter((path) => !isGeneratedPath(path)).sort();
}

function listCurrentInputs(repositoryRoot, pathspecs) {
  // Dirty local builds can consume non-ignored new source files that are not in Git's index yet.
  const output = execFileSync(
    'git',
    [
      '-C',
      repositoryRoot,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...pathspecs,
    ],
    { encoding: 'buffer' },
  );
  return filterInputPaths(readInputPaths(output));
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
  const untracked = execFileSync(
    'git',
    [
      '-C',
      repositoryRoot,
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
      '--',
      ...BUILD_INPUT_PATHS,
    ],
    { encoding: 'buffer' },
  );
  return filterInputPaths([...readInputPaths(output), ...readInputPaths(untracked)]);
}

function hashCurrentInputs(repositoryRoot, pathspecs, inputHashes = {}) {
  const paths = listCurrentInputs(repositoryRoot, pathspecs);
  if (paths.length === 0)
    throw new Error(`No tracked Detox cache inputs matched: ${pathspecs.join(', ')}`);

  const hash = createHash('sha256');
  let observedPrivacyManifestHash;
  let observedCocoapodsProjectHash;
  for (const path of paths) {
    const absolutePath = join(repositoryRoot, path);
    const stat = lstatSync(absolutePath);
    const contents = stat.isSymbolicLink()
      ? Buffer.from(`symlink:${readlinkSync(absolutePath)}`)
      : readFileSync(absolutePath);
    if (
      (path === PRIVACY_MANIFEST_INPUT || path === COCOAPODS_PROJECT_INPUT) &&
      stat.isSymbolicLink()
    ) {
      throw new Error(`Refusing to normalize a symlinked CocoaPods build input: ${path}`);
    }
    let normalizedContents = contents;
    if (path === PRIVACY_MANIFEST_INPUT || path === COCOAPODS_PROJECT_INPUT) {
      const suppliedHash =
        path === PRIVACY_MANIFEST_INPUT
          ? inputHashes.privacyManifestInputHash
          : inputHashes.cocoapodsProjectInputHash;
      const digest = suppliedHash ?? createHash('sha256').update(contents).digest('hex');
      if (!SHA256_PATTERN.test(digest)) {
        throw new Error(`Invalid pre-Pods input fingerprint for ${path}.`);
      }
      if (path === PRIVACY_MANIFEST_INPUT) {
        observedPrivacyManifestHash = digest;
        normalizedContents = Buffer.from('privacy-manifest-sha256:' + digest);
      } else {
        observedCocoapodsProjectHash = digest;
        normalizedContents = Buffer.from('cocoapods-project-sha256:' + digest);
      }
    }
    hash.update(path);
    hash.update('\0');
    hash.update(normalizedContents);
    hash.update('\0');
  }
  return {
    fingerprint: hash.digest('hex'),
    count: paths.length,
    privacyManifestInputHash: observedPrivacyManifestHash,
    cocoapodsProjectInputHash: observedCocoapodsProjectHash,
  };
}

function hashNativeDependencyInputs(repositoryRoot, inputHashes = {}) {
  const trackedInputs = hashCurrentInputs(
    repositoryRoot,
    NATIVE_DEPENDENCY_INPUT_PATHS,
    inputHashes,
  );
  const buildConfigs = fingerprintDetoxBuildConfigs(repositoryRoot);
  const hash = createHash('sha256');
  hash.update(trackedInputs.fingerprint);
  hash.update('\0');
  hash.update(JSON.stringify(buildConfigs));
  return { fingerprint: hash.digest('hex'), count: trackedInputs.count + buildConfigs.length };
}

export function computeDetoxCacheFingerprints(repositoryRoot = process.cwd(), options = {}) {
  const root = resolve(repositoryRoot);
  const buildInputs = hashCurrentInputs(root, BUILD_INPUT_PATHS, options);
  const reactNativeArtifacts = hashCurrentInputs(root, REACT_NATIVE_ARTIFACT_PATHS);
  const nativeDependencies = hashNativeDependencyInputs(root, options);
  return makeFingerprintOutput({
    buildInputs,
    reactNativeArtifacts,
    nativeDependencies,
    privacyManifestInputHash: buildInputs.privacyManifestInputHash,
    cocoapodsProjectInputHash: buildInputs.cocoapodsProjectInputHash,
  });
}

export function computeDetoxReactNativeArtifactFingerprint(repositoryRoot = process.cwd()) {
  const artifacts = hashCurrentInputs(resolve(repositoryRoot), REACT_NATIVE_ARTIFACT_PATHS);
  return makeFingerprintOutput({ reactNativeArtifacts: artifacts });
}

export function computeDetoxDerivedDataFingerprints(repositoryRoot = process.cwd(), options = {}) {
  const root = resolve(repositoryRoot);
  const buildInputs = hashCurrentInputs(root, BUILD_INPUT_PATHS, options);
  const nativeDependencies = hashNativeDependencyInputs(root, options);
  return makeFingerprintOutput({
    buildInputs,
    nativeDependencies,
    privacyManifestInputHash: buildInputs.privacyManifestInputHash,
    cocoapodsProjectInputHash: buildInputs.cocoapodsProjectInputHash,
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
