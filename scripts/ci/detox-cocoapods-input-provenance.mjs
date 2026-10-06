import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  computeDetoxCacheFingerprints,
  listChangedDetoxBuildInputs,
} from './detox-cache-fingerprint.mjs';
import {
  readDetoxBuildInputSnapshot,
  writeDetoxBuildInputSnapshot,
} from './detox-build-input-snapshot.mjs';

// Capture the tracked CocoaPods outputs so later native build stages cannot change them silently.
export const EXPECTED_COCOAPODS_INPUT_HASHES_ENV = 'EXPECTED_COCOAPODS_INPUT_HASHES_JSON';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const EXPECTED_BUILD_FINGERPRINT_ENV = 'EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT';
const EXPECTED_NATIVE_FINGERPRINT_ENV = 'EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT';
const INPUTS = {
  privacyManifest: 'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
  projectFile: 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
};
const GENERATED_INPUTS = new Set(Object.values(INPUTS));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateHashes(value, label) {
  const keys = Object.keys(INPUTS).sort();
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !== keys.join(',') ||
    keys.some((key) => typeof value[key] !== 'string' || !HASH_PATTERN.test(value[key]))
  ) {
    throw new Error(`Invalid ${label} CocoaPods input hashes.`);
  }
  return { privacyManifest: value.privacyManifest, projectFile: value.projectFile };
}

export function readExpectedCocoapodsInputHashes() {
  const serialized = process.env[EXPECTED_COCOAPODS_INPUT_HASHES_ENV];
  if (serialized === undefined) return null;
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Invalid serialized expected CocoaPods input hashes.');
  }
  return validateHashes(parsed, 'expected');
}

export function readCocoapodsInputHashes(repositoryRoot = process.cwd()) {
  const root = resolve(repositoryRoot);
  const hashes = {};
  for (const [name, path] of Object.entries(INPUTS)) {
    const absolutePath = join(root, path);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Refusing to fingerprint a non-file CocoaPods input: ${path}`);
    }
    hashes[name] = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
  }
  return hashes;
}

export function assertCocoapodsInputHashesEqual(actual, expected, stage) {
  const current = validateHashes(actual, 'observed');
  const captured = validateHashes(expected, 'expected');
  const changed = Object.keys(INPUTS).filter((name) => current[name] !== captured[name]);
  if (changed.length > 0) {
    throw new Error(`CocoaPods input hashes changed ${stage}: ${changed.join(',')}`);
  }
}

function readExpectedFingerprints() {
  const fingerprints = {
    buildInputs: process.env[EXPECTED_BUILD_FINGERPRINT_ENV],
    nativeDependencies: process.env[EXPECTED_NATIVE_FINGERPRINT_ENV],
  };
  if (
    !HASH_PATTERN.test(fingerprints.buildInputs ?? '') ||
    !HASH_PATTERN.test(fingerprints.nativeDependencies ?? '')
  ) {
    throw new Error('Missing or invalid prebuild Detox cache fingerprints.');
  }
  return fingerprints;
}

function assertFingerprintsEqual(actual, expected, stage) {
  const changed = ['buildInputs', 'nativeDependencies'].filter(
    (name) => actual[name] !== expected[name],
  );
  if (changed.length > 0) {
    throw new Error(
      `Refusing to continue after prebuild_fingerprint_mismatch ${stage}: ${changed.join(',')}`,
    );
  }
}

function computeFingerprints(repositoryRoot, inputHashes) {
  return computeDetoxCacheFingerprints(repositoryRoot, {
    privacyManifestInputHash: inputHashes.privacyManifest,
    cocoapodsProjectInputHash: inputHashes.projectFile,
  });
}

function rejectUnexpectedBuildInputChanges(repositoryRoot, stage) {
  const unexpected = listChangedDetoxBuildInputs(repositoryRoot).filter(
    (path) => !GENERATED_INPUTS.has(path),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Refusing to continue after unexpected build-input changes ${stage}: ${JSON.stringify(unexpected)}`,
    );
  }
}

export function recordPreparedDetoxBuildInputs(
  repositoryRoot,
  profile,
  manifest,
  shouldSnapshot = true,
) {
  const baseline = readExpectedCocoapodsInputHashes();
  if (!baseline) {
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_ENV) {
      throw new Error('Expected CocoaPods input hashes are required in GitHub Actions.');
    }
    return;
  }
  const fingerprints = readExpectedFingerprints();
  assertCocoapodsInputHashesEqual(
    readCocoapodsInputHashes(repositoryRoot),
    baseline,
    'before cache lookup',
  );
  assertFingerprintsEqual(manifest, fingerprints, 'before cache lookup');
  if (!shouldSnapshot) return;
  writeDetoxBuildInputSnapshot(profile, {
    schemaVersion: 1,
    profile,
    stage: 'prepared',
    baseline,
    fingerprints,
  });
}

export function validateDetoxInputsBeforeCacheLookup(repositoryRoot, manifest) {
  const baseline = readExpectedCocoapodsInputHashes();
  if (!baseline) {
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_ENV) {
      throw new Error('Expected CocoaPods input hashes are required in GitHub Actions.');
    }
    return;
  }
  assertCocoapodsInputHashesEqual(
    readCocoapodsInputHashes(repositoryRoot),
    baseline,
    'before cache lookup',
  );
  assertFingerprintsEqual(manifest, readExpectedFingerprints(), 'before cache lookup');
}

export function verifyDetoxBuildInputs(repositoryRoot, profile) {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Detox build-input verification is limited to GitHub Actions runners.');
  }
  const baseline = readExpectedCocoapodsInputHashes();
  if (!baseline) throw new Error('Expected CocoaPods input hashes are required.');
  const fingerprints = readExpectedFingerprints();
  const snapshot = readDetoxBuildInputSnapshot(profile);
  if (snapshot.stage !== 'prepared') {
    throw new Error(`Detox build-input snapshot was not prepared for ${profile}.`);
  }
  assertCocoapodsInputHashesEqual(snapshot.baseline, baseline, 'after cache preparation');
  assertFingerprintsEqual(snapshot.fingerprints, fingerprints, 'after cache preparation');

  // The diff may contain only the two tracked files CocoaPods integrates.
  rejectUnexpectedBuildInputChanges(repositoryRoot, 'after CocoaPods install');
  const current = computeFingerprints(repositoryRoot, baseline);
  assertFingerprintsEqual(current, fingerprints, 'after CocoaPods install');
  const afterInstall = readCocoapodsInputHashes(repositoryRoot);
  writeDetoxBuildInputSnapshot(profile, {
    ...snapshot,
    stage: 'verified',
    afterInstall,
  });
  return { baseline, afterInstall, fingerprints };
}

export function verifyDetoxBuildInputsBeforeManifest(repositoryRoot, profile, manifest) {
  const baseline = readExpectedCocoapodsInputHashes();
  if (!baseline) {
    const current = readCocoapodsInputHashes(repositoryRoot);
    return { baseline: current, afterInstall: current };
  }
  const snapshot = readDetoxBuildInputSnapshot(profile);
  if (snapshot.stage !== 'verified') {
    throw new Error(`Detox build-input snapshot is not verified for ${profile}.`);
  }
  assertCocoapodsInputHashesEqual(snapshot.baseline, baseline, 'before manifest write');
  assertCocoapodsInputHashesEqual(
    readCocoapodsInputHashes(repositoryRoot),
    snapshot.afterInstall,
    'after build-input verification and before manifest write',
  );
  assertFingerprintsEqual(manifest, snapshot.fingerprints, 'before manifest write');
  rejectUnexpectedBuildInputChanges(repositoryRoot, 'before manifest write');
  return { baseline: snapshot.baseline, afterInstall: snapshot.afterInstall };
}
