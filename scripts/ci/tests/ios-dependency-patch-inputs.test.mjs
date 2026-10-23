import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { computeIosCacheFingerprints } from '../ios-cache-fingerprint.mjs';
import { buildInputDigest, productContext } from '../ios-test-product-context.mjs';
import { selectChecksForPaths } from '../changed-paths-select.mjs';
import {
  createFixtureRepository,
  git,
  writeFixtureFile,
} from './fixtures/ios-derived-data-cache.mjs';

// A changed patch is executable dependency input, even before its lockfile hash is regenerated.
test('pinned dependency patches invalidate both native build input boundaries', () => {
  const root = createFixtureRepository();
  try {
    const before = computeIosCacheFingerprints(root);
    const inputBefore = buildInputDigest(root);
    writeFixtureFile(root, 'vendor/patches/example@1.0.0.patch', 'new dependency implementation');
    const changed = computeIosCacheFingerprints(root);
    assert.notEqual(changed.buildInputs, before.buildInputs);
    assert.notEqual(changed.platformDependencies, before.platformDependencies);
    assert.throws(
      () => productContext(root, 'core', { GITHUB_ACTIONS: 'true' }),
      /source inputs differ/,
    );
    git(root, 'add', 'vendor/patches/example@1.0.0.patch');
    // Keep the follow-up commit independent of runner identity and signing defaults.
    git(
      root,
      '-c',
      'user.name=CI fixture',
      '-c',
      'user.email=ci-fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'Track dependency patch',
    );
    assert.notEqual(buildInputDigest(root), inputBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dependency patch selects all consumers even when formatters exclude its diff syntax', () => {
  const selection = selectChecksForPaths(['vendor/patches/react-native@0.87.1.patch']);
  assert.equal(selection.ios_build, true);
  assert.equal(selection.ios_tests, true);
  assert.equal(selection.typecheck, true);
  assert.equal(selection.unit_tests, true);
});
