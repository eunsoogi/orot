import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import {
  computeIosCacheFingerprints,
  listChangedIosBuildInputs,
} from '../ios-cache-fingerprint.mjs';
import { buildInputDigest, productContext } from '../ios-test-product-context.mjs';
import { selectChecksForPaths } from '../changed-paths-select.mjs';
import {
  createFixtureRepository,
  git,
  writeFixtureFile,
} from './fixtures/ios-derived-data-cache.mjs';

const directory = 'vendor/onnxruntime-swift-package-manager';
const source = `${directory}/objectivec/ort_session.mm`;

function commit(root) {
  git(root, 'add', directory);
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
    'Track exact upstream package',
  );
}

// Local packages have no remote pin: every source mutation must invalidate native products.
test('vendored ONNX additions and mutations invalidate cache, product provenance and dirty fences', () => {
  const root = createFixtureRepository();
  try {
    const empty = computeIosCacheFingerprints(root);
    const emptyDigest = buildInputDigest(root);
    writeFixtureFile(root, source, 'original upstream implementation');
    const added = computeIosCacheFingerprints(root);
    assert.notEqual(added.buildInputs, empty.buildInputs);
    assert.notEqual(added.platformDependencies, empty.platformDependencies);
    assert.ok(listChangedIosBuildInputs(root).includes(source));
    assert.throws(
      () => productContext(root, 'core', { GITHUB_ACTIONS: 'true' }),
      /source inputs differ/,
    );
    commit(root);
    const committedDigest = buildInputDigest(root);
    assert.notEqual(committedDigest, emptyDigest);
    assert.deepEqual(listChangedIosBuildInputs(root), []);
    writeFixtureFile(root, source, 'modified upstream implementation');
    const modified = computeIosCacheFingerprints(root);
    assert.notEqual(modified.buildInputs, added.buildInputs);
    assert.notEqual(modified.platformDependencies, added.platformDependencies);
    assert.ok(listChangedIosBuildInputs(root).includes(source));
    assert.throws(
      () => productContext(root, 'core', { GITHUB_ACTIONS: 'true' }),
      /source inputs differ/,
    );
    commit(root);
    assert.notEqual(buildInputDigest(root), committedDigest);
    rmSync(`${root}/${source}`);
    assert.ok(listChangedIosBuildInputs(root).includes(source));
    assert.throws(
      () => productContext(root, 'core', { GITHUB_ACTIONS: 'true' }),
      /source inputs differ/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Metadata/resources may alter the package graph; do not route them as documentation-only.
for (const file of [
  'Package.swift',
  'objectivec/ort_session.mm',
  'LICENSE',
  'README.md',
  'fixture.png',
]) {
  test(`vendored ONNX ${file} selects dependency consumers`, () => {
    const selection = selectChecksForPaths([`${directory}/${file}`]);
    assert.equal(selection.reason, 'vendored-native-dependency-change');
    assert.equal(selection.ios_build, true);
    assert.equal(selection.ios_tests, true);
    assert.equal(selection.typecheck, true);
    assert.equal(selection.unit_tests, true);
  });
}

test('unrelated vendor sibling does not enter the ONNX cache or dependency routing boundary', () => {
  const root = createFixtureRepository();
  try {
    const before = computeIosCacheFingerprints(root);
    const beforeDigest = buildInputDigest(root);
    const sibling = 'vendor/onnxruntime-swift-package-manager-other/README.md';
    writeFixtureFile(root, sibling, 'unrelated documentation');
    assert.deepEqual(computeIosCacheFingerprints(root), before);
    assert.deepEqual(listChangedIosBuildInputs(root), []);
    assert.equal(buildInputDigest(root), beforeDigest);
    assert.notEqual(selectChecksForPaths([sibling]).reason, 'vendored-native-dependency-change');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
