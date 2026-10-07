import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const INPUT_HASH_KEYS = ['privacyManifest', 'projectFile'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateInputHashes(value, label) {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !== INPUT_HASH_KEYS.join(',') ||
    INPUT_HASH_KEYS.some((key) => typeof value[key] !== 'string' || !HASH_PATTERN.test(value[key]))
  ) {
    throw new Error(`Invalid ${label} CocoaPods input hashes.`);
  }
  return { privacyManifest: value.privacyManifest, projectFile: value.projectFile };
}

function getSnapshotPath(profile) {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) throw new Error('RUNNER_TEMP is required for Detox build-input provenance.');
  return join(runnerTemp, `orot-detox-build-input-${profile}.json`);
}

function validateSnapshot(profile, value) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.profile !== profile ||
    !['prepared', 'verified'].includes(value.stage)
  ) {
    throw new Error(`Invalid Detox build-input snapshot for ${profile}.`);
  }
  const baseline = validateInputHashes(value.baseline, 'snapshot baseline');
  const fingerprints = value.fingerprints;
  if (
    !isRecord(fingerprints) ||
    !HASH_PATTERN.test(fingerprints.buildInputs ?? '') ||
    !HASH_PATTERN.test(fingerprints.nativeDependencies ?? '')
  ) {
    throw new Error(`Invalid Detox build-input fingerprints in the ${profile} snapshot.`);
  }
  const snapshot = {
    schemaVersion: 1,
    profile,
    stage: value.stage,
    baseline,
    fingerprints: {
      buildInputs: fingerprints.buildInputs,
      nativeDependencies: fingerprints.nativeDependencies,
    },
  };
  if (value.stage === 'verified') {
    snapshot.afterInstall = validateInputHashes(value.afterInstall, 'snapshot after-install');
  } else if (value.afterInstall !== undefined) {
    throw new Error(`Prepared ${profile} snapshot must not contain after-install hashes.`);
  }
  return snapshot;
}

// An atomic runner-temp snapshot binds cache preparation, CocoaPods output, and manifest writing.
export function writeDetoxBuildInputSnapshot(profile, value) {
  const snapshot = validateSnapshot(profile, value);
  const path = getSnapshotPath(profile);
  try {
    const existing = lstatSync(path);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(`Refusing to replace an unsafe Detox build-input snapshot: ${path}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    renameSync(temporaryPath, path);
  } catch (error) {
    unlinkSync(temporaryPath);
    throw error;
  }
}

export function readDetoxBuildInputSnapshot(profile) {
  const path = getSnapshotPath(profile);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Detox build-input snapshot is missing for ${profile}.`);
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Refusing to read an unsafe Detox build-input snapshot: ${path}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Detox build-input snapshot is invalid JSON for ${profile}.`);
  }
  return validateSnapshot(profile, parsed);
}
