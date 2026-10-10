import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeDetoxCacheFingerprints,
  computeDetoxDerivedDataFingerprints,
  computeDetoxReactNativeArtifactFingerprint,
  listChangedDetoxBuildInputs,
} from './detox-cache-fingerprint.mjs';
import { computeDetoxCocoapodsCacheFingerprint } from './detox-cocoapods-cache-fingerprint.mjs';

function writeGitHubOutputs(outputPath, fingerprints, { includeFingerprintJson = false } = {}) {
  const outputLines = [];
  if (fingerprints.buildInputs) {
    outputLines.push(`build_inputs=${fingerprints.buildInputs}`);
    outputLines.push(`build_input_count=${fingerprints.buildInputCount}`);
  }
  if (fingerprints.reactNativeArtifacts) {
    outputLines.push(`react_native_artifacts=${fingerprints.reactNativeArtifacts}`);
  }
  if (fingerprints.nativeDependencies) {
    outputLines.push(`native_dependencies=${fingerprints.nativeDependencies}`);
    outputLines.push(`native_dependency_input_count=${fingerprints.nativeDependencyInputCount}`);
  }
  if (fingerprints.cocoapodsInputs) {
    outputLines.push(`cocoapods_inputs=${fingerprints.cocoapodsInputs}`);
  }
  if (fingerprints.privacyManifestInputHash) {
    outputLines.push(`privacy_manifest_input_sha256=${fingerprints.privacyManifestInputHash}`);
  }
  if (fingerprints.cocoapodsProjectInputHash) {
    outputLines.push(`cocoapods_project_input_sha256=${fingerprints.cocoapodsProjectInputHash}`);
  }
  // Only the normalized resolver publishes the object consumed by profile-cache inputs.
  if (
    includeFingerprintJson &&
    fingerprints.buildInputs &&
    fingerprints.nativeDependencies &&
    fingerprints.privacyManifestInputHash &&
    fingerprints.cocoapodsProjectInputHash
  ) {
    outputLines.push(
      `fingerprints=${JSON.stringify({
        build_inputs: fingerprints.buildInputs,
        build_input_count: String(fingerprints.buildInputCount),
        native_dependencies: fingerprints.nativeDependencies,
        native_dependency_input_count: String(fingerprints.nativeDependencyInputCount),
        privacy_manifest_input_sha256: fingerprints.privacyManifestInputHash,
        cocoapods_project_input_sha256: fingerprints.cocoapodsProjectInputHash,
      })}`,
    );
  }
  appendFileSync(outputPath, `${outputLines.join('\n')}\n`);
}

function writeGitHubEnvironment(outputPath, fingerprints) {
  if (!outputPath || !fingerprints.buildInputs || !fingerprints.nativeDependencies) return;
  // Later Actions steps use these source hashes after CocoaPods has rewritten its tracked outputs.
  const inputHashes = JSON.stringify({
    privacyManifest: fingerprints.privacyManifestInputHash,
    projectFile: fingerprints.cocoapodsProjectInputHash,
  });
  appendFileSync(
    outputPath,
    [
      `EXPECTED_COCOAPODS_INPUT_HASHES_JSON=${inputHashes}`,
      `EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT=${fingerprints.buildInputs}`,
      `EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT=${fingerprints.nativeDependencies}`,
    ].join('\n') + '\n',
  );
}

function readPrecomputedDerivedDataFingerprints() {
  let values;
  try {
    values = JSON.parse(process.env.DETOX_CACHE_FINGERPRINTS_JSON ?? '');
  } catch {
    throw new Error('DETOX_CACHE_FINGERPRINTS_JSON must contain valid fingerprint JSON.');
  }

  const readHash = (name) => {
    const value = values?.[name];
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`The precomputed Detox fingerprint ${name} must be a SHA-256 hex value.`);
    }
    return value;
  };
  const readCount = (name) => {
    const rawValue = values?.[name];
    const value =
      typeof rawValue === 'string' && /^\d+$/.test(rawValue) ? Number(rawValue) : rawValue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`The precomputed Detox fingerprint ${name} must be a non-negative integer.`);
    }
    return value;
  };

  // The CLI can republish upstream hashes to later Actions steps through GITHUB_ENV.
  return {
    buildInputs: readHash('build_inputs'),
    buildInputCount: readCount('build_input_count'),
    nativeDependencies: readHash('native_dependencies'),
    nativeDependencyInputCount: readCount('native_dependency_input_count'),
    privacyManifestInputHash: readHash('privacy_manifest_input_sha256'),
    cocoapodsProjectInputHash: readHash('cocoapods_project_input_sha256'),
  };
}

function readSharedDerivedDataFingerprints() {
  const rawValue = process.env.DETOX_SHARED_FINGERPRINTS_JSON;
  if (rawValue == null || rawValue.trim() === '') return undefined;

  let outputs;
  try {
    outputs = JSON.parse(rawValue);
  } catch {
    throw new Error('DETOX_SHARED_FINGERPRINTS_JSON must contain valid fingerprint JSON.');
  }
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    throw new Error('Shared Detox fingerprint outputs must be a JSON object.');
  }

  // GitHub emits blank needs-job outputs on helper failure; partial nonempty data remains fail-closed.
  if (
    !Object.values(outputs).some((value) => value !== undefined && value !== null && value !== '')
  ) {
    return undefined;
  }
  const readHash = (name) => {
    const value = outputs[name];
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`Shared Detox fingerprint ${name} must be a SHA-256 hex value.`);
    }
    return value;
  };
  const readCount = (name) => {
    const rawCount = outputs[name];
    const count =
      typeof rawCount === 'string' && /^\d+$/.test(rawCount) ? Number(rawCount) : rawCount;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Shared Detox fingerprint ${name} must be a non-negative integer.`);
    }
    return count;
  };

  return {
    buildInputs: readHash('build_inputs'),
    buildInputCount: readCount('build_input_count'),
    nativeDependencies: readHash('native_dependencies'),
    nativeDependencyInputCount: readCount('native_dependency_input_count'),
    privacyManifestInputHash: readHash('privacy_manifest_input_sha256'),
    cocoapodsProjectInputHash: readHash('cocoapods_project_input_sha256'),
    fingerprintSource: 'shared',
  };
}

function computeFingerprints(mode) {
  if (mode === '--react-native-artifacts-only') {
    return computeDetoxReactNativeArtifactFingerprint();
  }
  if (mode === '--cocoapods-cache-inputs-only') {
    return { cocoapodsInputs: computeDetoxCocoapodsCacheFingerprint() };
  }
  if (mode === '--derived-data-only') return computeDetoxDerivedDataFingerprints();
  if (mode === '--precomputed-derived-data-only') {
    return readPrecomputedDerivedDataFingerprints();
  }
  if (mode === '--resolve-shared-derived-data-only') {
    return (
      readSharedDerivedDataFingerprints() ?? {
        ...computeDetoxDerivedDataFingerprints(),
        fingerprintSource: 'local',
      }
    );
  }
  return computeDetoxCacheFingerprints();
}

function main() {
  const [mode] = process.argv.slice(2);
  if (
    process.argv.length > 3 ||
    ![
      undefined,
      '--react-native-artifacts-only',
      '--cocoapods-cache-inputs-only',
      '--derived-data-only',
      '--precomputed-derived-data-only',
      '--resolve-shared-derived-data-only',
      '--changed-build-inputs',
    ].includes(mode)
  ) {
    throw new Error(
      'Usage: detox-cache-fingerprint-cli.mjs [--react-native-artifacts-only|--cocoapods-cache-inputs-only|--derived-data-only|--precomputed-derived-data-only|--resolve-shared-derived-data-only|--changed-build-inputs]',
    );
  }
  if (mode === '--changed-build-inputs') {
    // Emit the same post-install drift list so profile preparation can overlap it with cache restore.
    process.stdout.write(`${JSON.stringify(listChangedDetoxBuildInputs())}\n`);
    return;
  }
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath)
    throw new Error('GITHUB_OUTPUT is required to publish Detox cache fingerprints.');
  if (
    (mode === '--precomputed-derived-data-only' || mode === '--resolve-shared-derived-data-only') &&
    !process.env.GITHUB_ENV
  ) {
    throw new Error(
      'GITHUB_ENV is required to restore Detox cache fingerprint environment variables.',
    );
  }

  const fingerprints = computeFingerprints(mode);
  writeGitHubOutputs(outputPath, fingerprints, {
    includeFingerprintJson: mode === '--resolve-shared-derived-data-only',
  });
  // Capture source input hashes before Pods can rewrite its tracked integration files.
  if (mode !== '--cocoapods-cache-inputs-only') {
    writeGitHubEnvironment(process.env.GITHUB_ENV, fingerprints);
  }
  console.log(
    [
      'DETOX_CACHE_FINGERPRINT',
      `build_inputs=${fingerprints.buildInputs ?? 'not_requested'}`,
      `tracked_files=${fingerprints.buildInputCount ?? 'not_requested'}`,
      `react_native_artifacts=${fingerprints.reactNativeArtifacts ?? 'not_requested'}`,
      `lockfiles=${fingerprints.reactNativeArtifactInputCount ?? 'not_requested'}`,
      `native_dependencies=${fingerprints.nativeDependencies ?? 'not_requested'}`,
      `cocoapods_inputs=${fingerprints.cocoapodsInputs ?? 'not_requested'}`,
      `native_inputs=${fingerprints.nativeDependencyInputCount ?? 'not_requested'}`,
      `privacy_manifest_input_sha256=${fingerprints.privacyManifestInputHash ?? 'not_requested'}`,
      `cocoapods_project_input_sha256=${fingerprints.cocoapodsProjectInputHash ?? 'not_requested'}`,
      ...(fingerprints.fingerprintSource
        ? [`fingerprint_source=${fingerprints.fingerprintSource}`]
        : []),
    ].join(' '),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
