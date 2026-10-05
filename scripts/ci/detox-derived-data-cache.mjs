import { existsSync, lstatSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import {
  clearAppOutputs,
  getDerivedDataRoot,
  getProfile,
  inspectCachedApp,
  removeDerivedDataRoot,
} from './ios-derived-data-cache-paths.mjs';

function requireGitHubActions() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('iOS DerivedData cache cleanup is limited to GitHub Actions runners.');
  }
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

function makeManifest(repositoryRoot, profile) {
  const fingerprints = computeDetoxCacheFingerprints(repositoryRoot, {
    privacyManifestInputHash: process.env.EXPECTED_PRIVACY_MANIFEST_INPUT_SHA256,
  });
  return {
    schemaVersion: 2,
    profile,
    toolchain: getToolchain(),
    nativeDependencies: fingerprints.nativeDependencies,
    buildInputs: fingerprints.buildInputs,
    privacyManifestInputHash: fingerprints.privacyManifestInputHash,
  };
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
  const app = inspectCachedApp(profile, dataRoot);
  if (app.reason) {
    console.log(
      `DETOX_DERIVEDDATA_CACHE manifest_write=refused profile=${profile} app_reason=${app.reason}`,
    );
    throw new Error(`Refusing to cache an invalid iOS app artifact: ${app.reason}`);
  }
  manifest.appArtifacts = app.artifacts;
  const fingerprintCheck = inspectManifestFingerprints(
    manifest,
    process.env.EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT,
    process.env.EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT,
  );
  const changedInputsDiagnostic =
    fingerprintCheck.match === 'false'
      ? ' build_input_changes=' + JSON.stringify(listChangedDetoxBuildInputs(repositoryRoot))
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
    return {
      ...inspectCacheManifest({ manifest: null, reason: 'derived_data_absent' }, expected),
      appReusable: false,
      appReuseReason: 'derived_data_absent',
    };
  }
  if (lstatSync(dataRoot).isSymbolicLink() || !lstatSync(dataRoot).isDirectory()) {
    throw new Error(`Refusing to inspect an unsafe Detox DerivedData cache path: ${dataRoot}`);
  }

  const manifestResult = readCacheManifest(dataRoot);
  const result = inspectCacheManifest(manifestResult, expected);
  let appReusable = false;
  let appReuseReason = 'cache_not_exact';
  if (result.classification === 'exact') {
    const app = inspectCachedApp(profile, dataRoot, manifestResult.manifest?.appArtifacts ?? null);
    appReuseReason = app.reason ?? 'validated';
    if (app.reason) {
      requireGitHubActions();
      clearAppOutputs(profile, dataRoot);
    } else {
      appReusable = true;
    }
  }
  if (result.classification === 'invalidated') {
    requireGitHubActions();
    removeDerivedDataRoot(profile, dataRoot);
    appReuseReason = 'cache_invalidated';
  }
  if (result.classification === 'dependency-compatible') {
    requireGitHubActions();
    clearAppOutputs(profile, dataRoot);
    appReuseReason = 'build_inputs_changed';
  }
  return { ...result, appReusable, appReuseReason };
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
        `app_reusable=${result.appReusable}`,
        `app_reuse_reason=${result.appReuseReason}`,
      ].join('\n') + '\n',
      { flag: 'a' },
    );
  }
  console.log(
    `DETOX_DERIVEDDATA_CACHE ${result.diagnostic} app_reusable=${result.appReusable} app_reuse_reason=${result.appReuseReason}`,
  );
}

function main() {
  const [command, profile, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || !['prepare', 'write'].includes(command) || !profile) {
    throw new Error(
      'Usage: detox-derived-data-cache.mjs <prepare|write> <release|openai-provider|production>',
    );
  }
  getProfile(profile);
  if (command === 'write') writeManifest(process.cwd(), profile);
  else writeGitHubOutput(prepareCache(process.cwd(), profile));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
