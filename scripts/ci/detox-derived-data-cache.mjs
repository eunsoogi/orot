import { existsSync, lstatSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectCacheManifest,
  inspectManifestFingerprints,
  getDetoxCacheToolchain,
  MANIFEST_FILENAME,
  readCacheManifest,
  writeCachePreparationOutput,
} from './detox-cache-manifest.mjs';
import {
  clearDetoxFrameworkCacheArtifacts,
  getDetoxFrameworkCacheRoot,
  inspectDetoxFrameworkCacheArtifacts,
} from './detox-framework-cache-artifacts.mjs';
import {
  computeDetoxCacheFingerprints,
  listChangedDetoxBuildInputs,
} from './detox-cache-fingerprint.mjs';
import {
  readCocoapodsInputHashes,
  readExpectedCocoapodsInputHashes,
  recordPreparedDetoxBuildInputs,
  validateDetoxInputsBeforeCacheLookup,
  verifyDetoxBuildInputs,
  verifyDetoxBuildInputsBeforeManifest,
} from './detox-cocoapods-input-provenance.mjs';
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

function makeManifest(repositoryRoot, profile) {
  // Hash source inputs before Pods so an exact app hit can skip native dependency installation.
  const capturedInputs = readExpectedCocoapodsInputHashes();
  const baselineInputs = capturedInputs ?? readCocoapodsInputHashes(repositoryRoot);
  if (!capturedInputs && process.env.EXPECTED_PRIVACY_MANIFEST_INPUT_SHA256) {
    baselineInputs.privacyManifest = process.env.EXPECTED_PRIVACY_MANIFEST_INPUT_SHA256;
  }
  const fingerprints = computeDetoxCacheFingerprints(repositoryRoot, {
    privacyManifestInputHash: baselineInputs.privacyManifest,
    cocoapodsProjectInputHash: baselineInputs.projectFile,
  });
  return {
    schemaVersion: 6,
    profile,
    toolchain: getDetoxCacheToolchain(),
    nativeDependencies: fingerprints.nativeDependencies,
    buildInputs: fingerprints.buildInputs,
    cocoapodsInputProvenance: { baseline: baselineInputs },
  };
}

function requiresDetoxRuntimeArtifacts(profile) {
  // Production CI caches only its app and Pods; its fallback never builds Detox's separate runner.
  return profile !== 'production';
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
  if (requiresDetoxRuntimeArtifacts(profile)) {
    const detoxArtifacts = inspectDetoxFrameworkCacheArtifacts(getDetoxFrameworkCacheRoot());
    if (detoxArtifacts.reason) {
      throw new Error(
        `Refusing to cache missing Detox framework outputs: ${detoxArtifacts.reason}`,
      );
    }
    manifest.detoxArtifacts = detoxArtifacts.artifacts;
  }
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
    `DETOX_DERIVEDDATA_CACHE manifest_fingerprint_check=${fingerprintCheck.match} profile=${profile} ${fingerprintCheck.diagnostic}${changedInputsDiagnostic}`,
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
    console.log(
      `DETOX_DERIVEDDATA_CACHE manifest_write=refused profile=${profile} reason=fingerprint_mismatch`,
    );
    throw new Error(
      `Refusing to write Detox cache manifest after prebuild_fingerprint_mismatch: ${fingerprintCheck.mismatchFields.join(',')}`,
    );
  }
  try {
    manifest.cocoapodsInputProvenance = verifyDetoxBuildInputsBeforeManifest(
      repositoryRoot,
      profile,
      manifest,
    );
  } catch (error) {
    console.log(
      `DETOX_DERIVEDDATA_CACHE manifest_write=refused profile=${profile} reason=input_provenance`,
    );
    throw error;
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
  console.log(
    `DETOX_DERIVEDDATA_CACHE manifest_write=written profile=${profile} ${fingerprintCheck.diagnostic}`,
  );
  console.log(`DETOX_DERIVEDDATA_CACHE manifest=written profile=${profile}`);
}

function prepareCache(repositoryRoot, profile) {
  const expected = makeManifest(repositoryRoot, profile);
  validateDetoxInputsBeforeCacheLookup(repositoryRoot, expected);
  const dataRoot = getDerivedDataRoot(repositoryRoot, profile);
  let result;
  if (!existsSync(dataRoot)) {
    result = {
      ...inspectCacheManifest({ manifest: null, reason: 'derived_data_absent' }, expected),
      appReusable: false,
      appReuseReason: 'derived_data_absent',
    };
  } else {
    if (lstatSync(dataRoot).isSymbolicLink() || !lstatSync(dataRoot).isDirectory()) {
      throw new Error(`Refusing to inspect an unsafe Detox DerivedData cache path: ${dataRoot}`);
    }

    const manifestResult = readCacheManifest(dataRoot);
    const inspected = inspectCacheManifest(manifestResult, expected);
    const detoxArtifacts = requiresDetoxRuntimeArtifacts(profile)
      ? inspectDetoxFrameworkCacheArtifacts(
          getDetoxFrameworkCacheRoot(),
          manifestResult.manifest?.detoxArtifacts ?? null,
        )
      : { reason: null };
    let appReusable = false;
    let appReuseReason = 'cache_not_exact';
    if (inspected.classification === 'exact') {
      const app = inspectCachedApp(
        profile,
        dataRoot,
        manifestResult.manifest?.appArtifacts ?? null,
      );
      appReuseReason = app.reason ?? detoxArtifacts.reason ?? 'validated';
      if (app.reason || detoxArtifacts.reason) {
        requireGitHubActions();
        clearAppOutputs(profile, dataRoot);
        if (detoxArtifacts.reason) clearDetoxFrameworkCacheArtifacts();
      } else {
        appReusable = true;
      }
    }
    if (inspected.classification === 'invalidated') {
      requireGitHubActions();
      removeDerivedDataRoot(profile, dataRoot);
      if (requiresDetoxRuntimeArtifacts(profile)) clearDetoxFrameworkCacheArtifacts();
      appReuseReason = 'cache_invalidated';
    }
    if (inspected.classification === 'dependency-compatible') {
      requireGitHubActions();
      clearAppOutputs(profile, dataRoot);
      if (detoxArtifacts.reason) clearDetoxFrameworkCacheArtifacts();
      appReuseReason = 'build_inputs_changed';
    }
    result = { ...inspected, appReusable, appReuseReason };
  }
  recordPreparedDetoxBuildInputs(repositoryRoot, profile, expected, !result.appReusable);
  return result;
}

function main() {
  const [command, profile, ...extra] = process.argv.slice(2);
  if (
    extra.length > 0 ||
    !['prepare', 'verify-build-inputs', 'write'].includes(command) ||
    !profile
  ) {
    throw new Error(
      'Usage: detox-derived-data-cache.mjs <prepare|verify-build-inputs|write> <release|openai-provider|transcription|production>',
    );
  }
  getProfile(profile);
  if (command === 'write') writeManifest(process.cwd(), profile);
  else if (command === 'verify-build-inputs') {
    verifyDetoxBuildInputs(process.cwd(), profile);
    console.log(
      `DETOX_DERIVEDDATA_CACHE build_inputs_verified profile=${profile} stage=post-pods-verified`,
    );
  } else
    writeCachePreparationOutput(prepareCache(process.cwd(), profile), process.env.GITHUB_OUTPUT);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
