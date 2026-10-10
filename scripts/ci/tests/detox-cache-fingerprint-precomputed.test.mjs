import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeDetoxDerivedDataFingerprints } from '../detox-cache-fingerprint.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fingerprintCliPath = join(repositoryRoot, 'scripts/ci/detox-cache-fingerprint-cli.mjs');

test('re-emits the exact shared hashes and rejects invalid values before writing outputs', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'orot-precomputed-detox-fingerprints-'));
  try {
    const computed = computeDetoxDerivedDataFingerprints(repositoryRoot);
    const shared = {
      build_inputs: computed.buildInputs,
      build_input_count: String(computed.buildInputCount),
      native_dependencies: computed.nativeDependencies,
      native_dependency_input_count: String(computed.nativeDependencyInputCount),
      privacy_manifest_input_sha256: computed.privacyManifestInputHash,
      cocoapods_project_input_sha256: computed.cocoapodsProjectInputHash,
    };
    const outputPath = join(tempRoot, 'github-output.txt');
    const environmentPath = join(tempRoot, 'github-environment.txt');

    // GITHUB_ENV belongs to one job, so profile jobs must re-emit validated upstream values locally.
    const result = spawnSync('node', [fingerprintCliPath, '--precomputed-derived-data-only'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DETOX_CACHE_FINGERPRINTS_JSON: JSON.stringify(shared),
        GITHUB_OUTPUT: outputPath,
        GITHUB_ENV: environmentPath,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      `build_inputs=${shared.build_inputs}\nbuild_input_count=${shared.build_input_count}\nnative_dependencies=${shared.native_dependencies}\nnative_dependency_input_count=${shared.native_dependency_input_count}\nprivacy_manifest_input_sha256=${shared.privacy_manifest_input_sha256}\ncocoapods_project_input_sha256=${shared.cocoapods_project_input_sha256}\n`,
    );
    assert.equal(
      readFileSync(environmentPath, 'utf8'),
      `EXPECTED_COCOAPODS_INPUT_HASHES_JSON={"privacyManifest":"${shared.privacy_manifest_input_sha256}","projectFile":"${shared.cocoapods_project_input_sha256}"}\nEXPECTED_DETOX_BUILD_INPUT_FINGERPRINT=${shared.build_inputs}\nEXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT=${shared.native_dependencies}\n`,
    );
    assert.ok(result.stdout.includes(`tracked_files=${shared.build_input_count}`));
    assert.ok(result.stdout.includes(`native_inputs=${shared.native_dependency_input_count}`));

    const invalidOutputPath = join(tempRoot, 'invalid-output.txt');
    const invalidResult = spawnSync(
      'node',
      [fingerprintCliPath, '--precomputed-derived-data-only'],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          DETOX_CACHE_FINGERPRINTS_JSON: JSON.stringify({ ...shared, build_inputs: 'invalid' }),
          GITHUB_OUTPUT: invalidOutputPath,
          GITHUB_ENV: join(tempRoot, 'invalid-environment.txt'),
        },
        encoding: 'utf8',
      },
    );
    assert.notEqual(invalidResult.status, 0);
    assert.match(invalidResult.stderr, /must be a SHA-256 hex value/);
    assert.equal(existsSync(invalidOutputPath), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
