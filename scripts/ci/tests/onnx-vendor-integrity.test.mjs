import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  isImmutableOnnxPath,
  manifestEntries,
  pinnedCommit,
  pinnedTree,
  vendorPath,
  verifyOnnxVendor,
} from '../verify-onnx-vendor.mjs';
import { buildInventory, classifyPath } from '../../quality/inventory.mjs';
import { exclusionFor } from '../loc-file-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(join(root, 'scripts/ci/onnx-vendor-manifest.json')));

test('all 75 upstream blobs, Git modes, tree and commit are pinned', () => {
  assert.deepEqual(verifyOnnxVendor(root), { commit: pinnedCommit, tree: pinnedTree, files: 75 });
  assert.throws(
    () => manifestEntries({ ...manifest, commit_object: manifest.commit_object + '\n' }),
    /provenance/,
  );
  assert.throws(
    () => manifestEntries({ ...manifest, ls_tree: manifest.ls_tree.replace('100755', '100644') }),
    /tree/,
  );
  assert.throws(() => manifestEntries({ ...manifest, tree: '0'.repeat(40) }), /provenance/);
});

for (const mutation of [
  'content',
  'missing',
  'additional',
  'mode',
  'symlink',
  'directory-symlink',
]) {
  test(`immutable vendor rejects ${mutation} and quality cannot silently exclude it`, async () => {
    const temp = mkdtempSync(join(tmpdir(), 'onnx-integrity-'));
    try {
      cpSync(join(root, vendorPath), join(temp, vendorPath), { recursive: true });
      const target = join(temp, vendorPath, 'Package.swift');
      if (mutation === 'content') writeFileSync(target, 'changed');
      if (mutation === 'missing') unlinkSync(target);
      if (mutation === 'additional')
        writeFileSync(join(temp, vendorPath, 'unexpected.swift'), 'added');
      if (mutation === 'mode') chmodSync(target, 0o755);
      if (mutation === 'symlink') {
        unlinkSync(target);
        symlinkSync('README.md', target);
      }
      if (mutation === 'directory-symlink') {
        rmSync(join(temp, vendorPath, 'objectivec'), { recursive: true });
        symlinkSync(join(root, vendorPath, 'objectivec'), join(temp, vendorPath, 'objectivec'));
      }
      assert.throws(() => verifyOnnxVendor(temp), /ONNX/);
      await assert.rejects(
        buildInventory({ root: temp, trackedPaths: [`${vendorPath}/Package.swift`] }),
        /ONNX/,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}

test('quality exception is exactly the upstream inventory, not a vendor-wide formatter bypass', async () => {
  const paths = manifestEntries().map((entry) => `${vendorPath}/${entry.path}`);
  const inventory = await buildInventory({ root, trackedPaths: paths });
  assert.equal(inventory.length, 75);
  for (const entry of inventory) {
    assert.equal(entry.kind, 'excluded');
    assert.equal(entry.validation, 'scripts/ci/tests/onnx-vendor-integrity.test.mjs');
  }
  assert.equal(isImmutableOnnxPath(`${vendorPath}/unexpected.swift`), false);
  assert.equal(classifyPath('vendor/another-package/Package.swift').kind, 'surface');
  // Preserve the existing general LOC policy; this package now additionally
  // receives exact byte/mode verification in the required policy-test job.
  const loc = JSON.parse(readFileSync(join(root, 'scripts/ci/loc-policy.json')));
  assert.ok(exclusionFor(`${vendorPath}/Package.swift`, loc));
  const workflow = readFileSync(join(root, '.github/workflows/policy-check.yml'), 'utf8');
  assert.match(workflow, /node --test scripts\/ci\/tests\/\*\.test\.mjs/);
});

test('Xcode links the local upstream product without a remote ONNX package reference', () => {
  const project = readFileSync(
    join(root, 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj'),
    'utf8',
  );
  assert.match(
    project,
    /F24E00000000000000000031[^=]*= \{\s*isa = XCLocalSwiftPackageReference;\s*relativePath = "\.\.\/\.\.\/\.\.\/vendor\/onnxruntime-swift-package-manager";/,
  );
  assert.match(
    project,
    /F24E00000000000000000021[^=]*= \{\s*isa = XCSwiftPackageProductDependency;\s*package = F24E00000000000000000031[^;]*;\s*productName = onnxruntime;/,
  );
  assert.doesNotMatch(project, /repositoryURL = [^;]*onnxruntime/);
  // Full upstream blob verification above also pins default binary URL/checksum
  // and preserves the existing environment-override behavior byte-for-byte.
});

// Moving ONNX to a local package must not upgrade unrelated resolved dependencies.
test('the regenerated workspace lock removes only the remote ONNX pin', () => {
  const lock = JSON.parse(
    readFileSync(
      join(root, 'apps/mobile/ios/OrotMobile.xcworkspace/xcshareddata/swiftpm/Package.resolved'),
    ),
  );
  assert.equal(lock.version, 3);
  assert.deepEqual(Object.fromEntries(lock.pins.map((pin) => [pin.identity, pin.state.revision])), {
    'jwt-kit': '7abc497b0f907191933c87166e9b6a41b9d028d6',
    'swift-asn1': '3b6410f7dee09eb33cdd26260c5fd47fda19b0e2',
    'swift-certificates': 'ff86b924ead66f853b8baf91f3c41926a8f36177',
    'swift-crypto': 'da9d28d69ebe3894b18376c8f2395c2f37b8448f',
    'swift-log': '9c6fb14227f55d8f711ce3847dc2f419fb0ecacb',
    'swift-package-support-sentencepiece': '48f1241971c19dc79c314e5a9c5b9c38cbf25a53',
  });
});
