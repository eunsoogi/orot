import { existsSync, lstatSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectCacheManifest,
  inspectManifestFingerprints,
  MANIFEST_FILENAME,
  readCacheManifest,
} from './detox-cache-manifest.mjs';
import {
  computeDetoxCacheFingerprints,
  listChangedDetoxBuildInputs,
} from './detox-cache-fingerprint.mjs';

const PROFILES = {
  release: {
    derivedDataPath: 'apps/mobile/ios/build',
    configuration: 'Release-iphonesimulator',
  },
  'openai-provider': {
    derivedDataPath: 'apps/mobile/ios/build-openai-provider',
    configuration: 'Debug-iphonesimulator',
  },
};

function requireGitHubActions() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Detox DerivedData cache cleanup is limited to GitHub Actions runners.');
  }
}

function getProfile(profile) {
  const configuration = PROFILES[profile];
  if (!configuration) throw new Error(`Unknown Detox cache profile: ${profile}`);
  return configuration;
}

function getToolchain() {
  const toolchain = {
    runnerOs: process.env.DETOX_CACHE_RUNNER_OS,
    runnerArch: process.env.DETOX_CACHE_RUNNER_ARCH,
    macosVersion: process.env.EXPECTED_MACOS_VERSION,
    nodeVersion: process.env.EXPECTED_NODE_VERSION,
    pnpmVersion: process.env.EXPECTED_PNPM_VERSION,
    rubyVersion: process.env.EXPECTED_RUBY_VERSION,
    cocoaPodsVersion: process.env.EXPECTED_COCOAPODS_VERSION,
    xcodeVersion: process.env.EXPECTED_XCODE_VERSION,
    iosSimulatorSdk: process.env.EXPECTED_IOS_SIMULATOR_SDK,
  };
  const missing = Object.entries(toolchain)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0)
    throw new Error(`Missing Detox cache toolchain values: ${missing.join(', ')}`);
  return toolchain;
}

function getDerivedDataRoot(repositoryRoot, profile) {
  const root = realpathSync(resolve(repositoryRoot));
  for (const directory of [join(root, 'apps'), join(root, 'apps/mobile')]) {
    if (
      !existsSync(directory) ||
      lstatSync(directory).isSymbolicLink() ||
      !lstatSync(directory).isDirectory()
    ) {
      throw new Error(`Refusing to use a symlinked Detox project directory: ${directory}`);
    }
  }
  const iosRoot = resolve(root, 'apps/mobile/ios');
  if (
    !existsSync(iosRoot) ||
    lstatSync(iosRoot).isSymbolicLink() ||
    !lstatSync(iosRoot).isDirectory()
  ) {
    throw new Error(`Refusing to use an unsafe iOS project directory: ${iosRoot}`);
  }
  const dataRoot = resolve(root, getProfile(profile).derivedDataPath);
  const relativeToIos = relative(iosRoot, dataRoot);
  if (!relativeToIos || relativeToIos.startsWith('..') || isAbsolute(relativeToIos)) {
    throw new Error(`Unsafe Detox DerivedData path: ${dataRoot}`);
  }
  return dataRoot;
}

function makeManifest(repositoryRoot, profile) {
  const fingerprints = computeDetoxCacheFingerprints(repositoryRoot);
  return {
    schemaVersion: 1,
    profile,
    toolchain: getToolchain(),
    nativeDependencies: fingerprints.nativeDependencies,
    buildInputs: fingerprints.buildInputs,
  };
}

function assertManagedDirectory(directoryPath, expectedRoot) {
  const relativeToRoot = relative(expectedRoot, directoryPath);
  if (!relativeToRoot || relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    throw new Error(`Refusing to remove a path outside cached DerivedData: ${directoryPath}`);
  }
  if (
    !existsSync(expectedRoot) ||
    lstatSync(expectedRoot).isSymbolicLink() ||
    !lstatSync(expectedRoot).isDirectory()
  ) {
    throw new Error(`Refusing to remove a path through an unsafe cache root: ${expectedRoot}`);
  }

  let currentPath = expectedRoot;
  for (const segment of relativeToRoot.split(sep)) {
    currentPath = join(currentPath, segment);
    if (!existsSync(currentPath)) return false;
    const stat = lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to follow a symbolic link in cached DerivedData: ${currentPath}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Refusing to remove a non-directory cache path: ${currentPath}`);
    }
  }
  return true;
}

function removeManagedDirectory(directoryPath, expectedRoot) {
  if (assertManagedDirectory(directoryPath, expectedRoot)) {
    rmSync(directoryPath, { recursive: true });
  }
}

function clearAppOutputs(profile, dataRoot) {
  const configuration = getProfile(profile).configuration;
  const appOutputs = [
    join(dataRoot, 'Build/Intermediates.noindex/OrotMobile.build', configuration),
    join(dataRoot, 'Build/Products', configuration, 'Orot.app'),
  ];
  appOutputs.forEach((path) => assertManagedDirectory(path, dataRoot));
  appOutputs.forEach((path) => removeManagedDirectory(path, dataRoot));
}

function writeManifest(repositoryRoot, profile) {
  requireGitHubActions();
  const dataRoot = getDerivedDataRoot(repositoryRoot, profile);
  if (!existsSync(dataRoot)) throw new Error(`Detox build did not create DerivedData: ${dataRoot}`);
  if (lstatSync(dataRoot).isSymbolicLink() || !lstatSync(dataRoot).isDirectory()) {
    throw new Error(
      `Refusing to write a Detox cache manifest outside a real DerivedData directory: ${dataRoot}`,
    );
  }

  const manifest = makeManifest(repositoryRoot, profile);
  const fingerprintCheck = inspectManifestFingerprints(
    manifest,
    process.env.EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT,
    process.env.EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT,
  );
  const changedInputsDiagnostic =
    fingerprintCheck.match === 'false'
      ? ` tracked_build_input_changes=${JSON.stringify(listChangedDetoxBuildInputs(repositoryRoot))}`
      : '';
  console.log(
    `DETOX_DERIVEDDATA_CACHE manifest_write=${fingerprintCheck.match === 'false' ? 'refused' : 'written'} profile=${profile} ${fingerprintCheck.diagnostic}${changedInputsDiagnostic}`,
  );
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    writeFileSync(
      outputPath,
      [
        `manifest_build_inputs=${manifest.buildInputs}`,
        `manifest_native_dependencies=${manifest.nativeDependencies}`,
        `manifest_fingerprint_match=${fingerprintCheck.match}`,
        `manifest_fingerprint_mismatch_fields=${fingerprintCheck.mismatchFields.join(',') || 'none'}`,
      ].join('\n') + '\n',
      { flag: 'a' },
    );
  }
  if (fingerprintCheck.match === 'false') {
    throw new Error(
      `Refusing to write Detox cache manifest after prebuild_fingerprint_mismatch: ${fingerprintCheck.mismatchFields.join(',')}`,
    );
  }

  const path = join(dataRoot, MANIFEST_FILENAME);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`Refusing to replace a symbolic-link Detox cache manifest: ${path}`);
  }
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
  console.log(`DETOX_DERIVEDDATA_CACHE manifest=written profile=${profile}`);
}

function prepareCache(repositoryRoot, profile) {
  const dataRoot = getDerivedDataRoot(repositoryRoot, profile);
  const expected = makeManifest(repositoryRoot, profile);
  if (!existsSync(dataRoot)) {
    return inspectCacheManifest({ manifest: null, reason: 'derived_data_absent' }, expected);
  }
  if (lstatSync(dataRoot).isSymbolicLink() || !lstatSync(dataRoot).isDirectory()) {
    throw new Error(`Refusing to inspect an unsafe Detox DerivedData cache path: ${dataRoot}`);
  }

  const result = inspectCacheManifest(readCacheManifest(dataRoot), expected);
  if (result.classification === 'invalidated') {
    requireGitHubActions();
    removeManagedDirectory(dataRoot, resolve(repositoryRoot, 'apps/mobile/ios'));
  }
  if (result.classification === 'dependency-compatible') {
    requireGitHubActions();
    clearAppOutputs(profile, dataRoot);
  }
  return result;
}

function writeGitHubOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    writeFileSync(
      outputPath,
      [
        `derived_data_cache_classification=${result.classification}`,
        `derived_data_cache_reason=${result.reason}`,
        `derived_data_cache_mismatch_fields=${result.mismatchFields.join(',') || 'none'}`,
        `derived_data_cache_diagnostic=${result.diagnostic}`,
      ].join('\n') + '\n',
      { flag: 'a' },
    );
  }
  console.log(`DETOX_DERIVEDDATA_CACHE ${result.diagnostic}`);
}

function main() {
  const [command, profile, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || !['prepare', 'write'].includes(command) || !profile) {
    throw new Error(
      'Usage: detox-derived-data-cache.mjs <prepare|write> <release|openai-provider>',
    );
  }
  getProfile(profile);
  if (command === 'write') writeManifest(process.cwd(), profile);
  else writeGitHubOutput(prepareCache(process.cwd(), profile));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
