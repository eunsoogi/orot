import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);
const helperPath = join(repositoryRoot, 'scripts/ci/prepare-rn-artifact-fingerprint.sh');

function workflowStep(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  const end = workflow.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : workflow.slice(start, end < 0 ? undefined : end);
}

function runFingerprintHelper(directory, pnpmHash, podfileHash, name) {
  const outputPath = join(directory, `${name}.out`);
  writeFileSync(outputPath, '');
  const result = spawnSync('bash', [helperPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      PNPM_LOCKFILE_HASH: pnpmHash,
      PODFILE_LOCK_HASH: podfileHash,
    },
  });
  return { ...result, outputPath };
}

test('captures one validated lockfile fingerprint for both cache key and later record', () => {
  const fingerprint = workflowStep('Prepare React Native artifact cache fingerprint');
  const cache = workflowStep('Cache React Native artifact archives');
  const record = workflowStep('Record Detox cache state');
  const fingerprintIndex = workflow.indexOf(
    '- name: Prepare React Native artifact cache fingerprint',
  );
  const cacheIndex = workflow.indexOf('- name: Cache React Native artifact archives');
  const podsInstallIndex = workflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const recordIndex = workflow.indexOf('- name: Record Detox cache state');
  const outputReference = /steps\.rn_artifact_fingerprint\.outputs\.fingerprint/;

  assert.match(fingerprint, /id: rn_artifact_fingerprint/);
  assert.match(fingerprint, /PNPM_LOCKFILE_HASH:.*hashFiles\('pnpm-lock\.yaml'\)/);
  assert.match(fingerprint, /PODFILE_LOCK_HASH:.*hashFiles\('apps\/mobile\/ios\/Podfile\.lock'\)/);
  assert.match(fingerprint, /run: scripts\/ci\/prepare-rn-artifact-fingerprint\.sh/);
  assert.doesNotMatch(fingerprint, /^\s+if:/m);
  assert.ok(
    fingerprintIndex < cacheIndex &&
      cacheIndex < podsInstallIndex &&
      podsInstallIndex < recordIndex,
  );
  assert.match(cache, /orot-rn-ios-artifacts-v3-/);
  assert.match(cache, outputReference);
  assert.doesNotMatch(cache, /hashFiles\(/);
  assert.match(
    record,
    /RN_ARTIFACT_FINGERPRINT:.*steps\.rn_artifact_fingerprint\.outputs\.fingerprint/,
  );
  assert.doesNotMatch(record, /RN_ARTIFACT_FINGERPRINT:.*hashFiles\(/);
});

test('fails closed for either missing lockfile hash and leaves no cache-key output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-rn-artifact-fingerprint-'));
  try {
    const missingPnpm = runFingerprintHelper(directory, '', 'pod-hash', 'missing-pnpm');
    const missingPodfile = runFingerprintHelper(directory, 'pnpm-hash', '', 'missing-podfile');
    const missingBoth = runFingerprintHelper(directory, '', '', 'missing-both');

    for (const result of [missingPnpm, missingPodfile, missingBoth]) {
      assert.notEqual(result.status, 0, result.stderr);
      assert.equal(readFileSync(result.outputPath, 'utf8'), '');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('writes the validated pre-restore values as one stable output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-rn-artifact-fingerprint-'));
  try {
    const result = runFingerprintHelper(directory, 'pnpm-hash', 'pod-hash', 'complete');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(result.outputPath, 'utf8'), 'fingerprint=pnpm-hash-pod-hash\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
