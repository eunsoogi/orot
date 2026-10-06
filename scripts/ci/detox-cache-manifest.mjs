import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MANIFEST_FILENAME = '.orot-detox-cache.json';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

// Pin every tool that can change a restored Simulator app or Detox runner output.
export function getDetoxCacheToolchain() {
  const toolchain = {
    runnerOs: process.env.DETOX_CACHE_RUNNER_OS,
    runnerArch: process.env.DETOX_CACHE_RUNNER_ARCH,
    macosVersion: process.env.MACOS_VERSION || process.env.EXPECTED_MACOS_VERSION,
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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCocoapodsInputHashPair(value) {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join(',') === 'privacyManifest,projectFile' &&
    typeof value.privacyManifest === 'string' &&
    FINGERPRINT_PATTERN.test(value.privacyManifest) &&
    typeof value.projectFile === 'string' &&
    FINGERPRINT_PATTERN.test(value.projectFile)
  );
}

function valueDigest(value) {
  if (value === undefined) return 'none';
  const serialized = JSON.stringify(value);
  return createHash('sha256')
    .update(serialized ?? 'undefined')
    .digest('hex');
}

function fingerprintDigest(value) {
  if (typeof value === 'string' && FINGERPRINT_PATTERN.test(value)) return value;
  return valueDigest(value);
}

export function readCacheManifest(dataRoot) {
  const manifestPath = join(dataRoot, MANIFEST_FILENAME);
  let stat;
  try {
    stat = lstatSync(manifestPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      manifest: null,
      reason: readdirSync(dataRoot).length === 0 ? 'empty_derived_data' : 'manifest_missing',
    };
  }

  if (stat.isSymbolicLink()) return { manifest: null, reason: 'manifest_symlink' };
  if (!stat.isFile()) return { manifest: null, reason: 'manifest_not_file' };
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return isRecord(manifest)
      ? { manifest, reason: null }
      : { manifest: null, reason: 'manifest_not_object' };
  } catch {
    return { manifest: null, reason: 'manifest_invalid_json' };
  }
}

function createDiagnostic(classification, reason, mismatchFields, previous, expected) {
  const fields = mismatchFields.length > 0 ? mismatchFields.join(',') : 'none';
  return [
    `classification=${classification}`,
    `reason=${reason}`,
    `mismatch_fields=${fields}`,
    `cached_manifest_sha256=${valueDigest(previous)}`,
    `expected_manifest_sha256=${valueDigest(expected)}`,
    `cached_toolchain_sha256=${valueDigest(previous?.toolchain)}`,
    `expected_toolchain_sha256=${valueDigest(expected?.toolchain)}`,
    `cached_native_dependency_sha256=${fingerprintDigest(previous?.nativeDependencies)}`,
    `expected_native_dependency_sha256=${fingerprintDigest(expected?.nativeDependencies)}`,
    `cached_build_input_sha256=${fingerprintDigest(previous?.buildInputs)}`,
    `expected_build_input_sha256=${fingerprintDigest(expected?.buildInputs)}`,
  ].join(' ');
}

export function inspectCacheManifest(readResult, expected) {
  const previous = readResult.manifest;
  if (!previous) {
    const classification = ['derived_data_absent', 'empty_derived_data'].includes(readResult.reason)
      ? 'miss'
      : 'invalidated';
    return {
      classification,
      reason: readResult.reason,
      mismatchFields: [],
      diagnostic: createDiagnostic(classification, readResult.reason, [], previous, expected),
    };
  }

  const mismatchFields = [];
  if (previous.schemaVersion !== expected.schemaVersion) mismatchFields.push('schema_version');
  if (previous.profile !== expected.profile) mismatchFields.push('profile');
  if (isRecord(previous.toolchain) && isRecord(expected.toolchain)) {
    const expectedToolchainFields = Object.keys(expected.toolchain).sort();
    for (const field of expectedToolchainFields) {
      if (previous.toolchain[field] !== expected.toolchain[field]) {
        mismatchFields.push(`toolchain.${field}`);
      }
    }
    if (Object.keys(previous.toolchain).some((field) => !expectedToolchainFields.includes(field))) {
      mismatchFields.push('toolchain.unknown_fields');
    }
  } else {
    mismatchFields.push('toolchain');
  }
  if (previous.nativeDependencies !== expected.nativeDependencies) {
    mismatchFields.push('native_dependencies');
  }
  if (!FINGERPRINT_PATTERN.test(previous.buildInputs ?? '')) {
    mismatchFields.push('build_inputs_format');
  }
  const previousProvenance = previous.cocoapodsInputProvenance;
  const expectedBaselineHashes = expected.cocoapodsInputProvenance?.baseline;
  // The pre-install baseline defines compatibility; afterInstall records generated integration state.
  if (!isRecord(previousProvenance)) {
    mismatchFields.push('cocoapods_input_provenance');
  } else {
    if (Object.keys(previousProvenance).sort().join(',') !== 'afterInstall,baseline') {
      mismatchFields.push('cocoapods_input_provenance.unknown_fields');
    }
    if (!isCocoapodsInputHashPair(previousProvenance.baseline)) {
      mismatchFields.push('cocoapods_input_provenance.baseline_format');
    } else if (
      !isCocoapodsInputHashPair(expectedBaselineHashes) ||
      previousProvenance.baseline.privacyManifest !== expectedBaselineHashes.privacyManifest ||
      previousProvenance.baseline.projectFile !== expectedBaselineHashes.projectFile
    ) {
      mismatchFields.push('cocoapods_input_provenance.baseline');
    }
    if (!isCocoapodsInputHashPair(previousProvenance.afterInstall)) {
      mismatchFields.push('cocoapods_input_provenance.after_install_format');
    }
  }

  const invalid = mismatchFields.length > 0;
  const exact = !invalid && previous.buildInputs === expected.buildInputs;
  const classification = invalid ? 'invalidated' : exact ? 'exact' : 'dependency-compatible';
  const reason = invalid
    ? 'manifest_incompatible'
    : exact
      ? 'manifest_matches'
      : 'build_inputs_changed';
  return {
    classification,
    reason,
    mismatchFields,
    diagnostic: createDiagnostic(classification, reason, mismatchFields, previous, expected),
  };
}

export function inspectManifestFingerprints(
  manifest,
  expectedBuildInputs,
  expectedNativeDependencies,
) {
  const provided = [expectedBuildInputs, expectedNativeDependencies].filter(
    (value) => value !== undefined,
  );
  if (provided.length === 0) {
    return {
      match: 'unverified',
      mismatchFields: [],
      diagnostic: 'manifest_fingerprint_match=unverified',
    };
  }

  const mismatchFields = [];
  if (provided.length !== 2) mismatchFields.push('prebuild_expectations_incomplete');
  const expected = [
    ['build_inputs', expectedBuildInputs, manifest.buildInputs],
    ['native_dependencies', expectedNativeDependencies, manifest.nativeDependencies],
  ];
  for (const [field, before, after] of expected) {
    if (before === undefined) continue;
    if (!FINGERPRINT_PATTERN.test(before) || !FINGERPRINT_PATTERN.test(after ?? '')) {
      mismatchFields.push(`${field}_fingerprint_format`);
    } else if (before !== after) {
      mismatchFields.push(field);
    }
  }

  const match = mismatchFields.length === 0 ? 'true' : 'false';
  const fields = mismatchFields.length > 0 ? mismatchFields.join(',') : 'none';
  const diagnostic = [
    `manifest_fingerprint_match=${match}`,
    `manifest_fingerprint_mismatch_fields=${fields}`,
    `prebuild_build_inputs_sha256=${fingerprintDigest(expectedBuildInputs)}`,
    `manifest_build_inputs_sha256=${fingerprintDigest(manifest.buildInputs)}`,
    `prebuild_native_dependencies_sha256=${fingerprintDigest(expectedNativeDependencies)}`,
    `manifest_native_dependencies_sha256=${fingerprintDigest(manifest.nativeDependencies)}`,
  ].join(' ');
  return { match, mismatchFields, diagnostic };
}
