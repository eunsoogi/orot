import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestBuildSpec, iosTestConfig } from '../ios-test-config.mjs';
import { checkArchiveNames, productDigest } from '../ios-test-product-integrity.mjs';

test('shares only identical generic Release inputs and preserves each execution destination', () => {
  assert.deepEqual(iosTestBuildSpec('core'), iosTestBuildSpec('speech'));
  assert.notDeepEqual(iosTestBuildSpec('core'), iosTestBuildSpec('provider-data'));
  for (const profile of ['core', 'speech', 'backup', 'fixtures', 'local-model', 'provider-data']) {
    assert.equal(iosTestConfig(profile).xcode, '27.1');
    assert.equal(iosTestConfig(profile).sdk, '27.1');
  }
  assert.equal(iosTestConfig('speech').runtimeBuild, '23C54');
  assert.equal(iosTestConfig('speech').runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-26-2');
  assert.equal(iosTestConfig('core').runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-27-0');
  assert.equal(iosTestConfig('core').device, 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro');
  assert.throws(() => iosTestConfig('unknown'), /Unknown integration test profile/);
});

test('rejects archive traversal and paths outside the product namespace', () => {
  checkArchiveNames('products/\nproducts/Release-iphonesimulator/Orot.app/Orot\n');
  for (const path of [
    'products/../../escape',
    '/absolute/path',
    'other/file',
    'products/evil\\path',
  ]) {
    assert.throws(() => checkArchiveNames(path), /Unsafe/);
  }
});

test('detects product mutation and rejects a symlink leaving the artifact root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ios-test-product-integrity-'));
  try {
    const products = join(root, 'products');
    mkdirSync(products);
    writeFileSync(join(products, 'app'), 'original', { mode: 0o755 });
    const original = await productDigest(products);
    writeFileSync(join(products, 'app'), 'modified');
    assert.notEqual(await productDigest(products), original);
    writeFileSync(join(root, 'outside'), 'outside');
    symlinkSync('../outside', join(products, 'escape'));
    await assert.rejects(productDigest(products), /leaves its verified root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
