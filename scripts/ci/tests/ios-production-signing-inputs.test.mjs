import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { productionSigningInputDigest } from '../ios-production-signing-inputs.mjs';

test('actual generated settings and tracked entitlements bind hosts despite equal HEAD inputs', () => {
  const roots = [
    mkdtempSync(join(tmpdir(), 'signing-a-')),
    mkdtempSync(join(tmpdir(), 'signing-b-')),
  ];
  const files = [
    'Podfile.lock',
    'Pods/Manifest.lock',
    'OrotMobile.xcodeproj/project.pbxproj',
    'OrotMobile.xcworkspace/contents.xcworkspacedata',
    'Pods/Pods.xcodeproj/project.pbxproj',
    'Pods/Target Support Files/Pods-OrotMobile/Pods-OrotMobile.debug.xcconfig',
    'OrotMobile/default.entitlements',
  ];
  const write = (root, file, value) => {
    const path = join(root, 'apps/mobile/ios', file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  try {
    for (const root of roots) {
      execFileSync('git', ['init', '-q', root]);
      for (const file of files) write(root, file, 'CHECKOUT=' + root + '\nSIGNING=original');
      execFileSync('git', ['-C', root, 'add', '.']);
    }
    const expected = productionSigningInputDigest(roots[0]);
    assert.equal(productionSigningInputDigest(roots[1]), expected);
    for (const file of files) {
      write(roots[1], file, 'changed actual signing settings');
      assert.notEqual(productionSigningInputDigest(roots[1]), expected, file);
      write(roots[1], file, 'CHECKOUT=' + roots[1] + '\nSIGNING=original');
    }
    // A root-like prefix outside the checkout must not become the same placeholder.
    for (const root of roots) write(root, files[0], 'PATH="' + root + '-other/config"');
    assert.notEqual(productionSigningInputDigest(roots[0]), productionSigningInputDigest(roots[1]));
    for (const root of roots) write(root, files[0], 'PATH="' + root + '/config"');
    assert.equal(productionSigningInputDigest(roots[0]), productionSigningInputDigest(roots[1]));
    for (const root of roots) {
      const target = join(root, 'generated-settings');
      mkdirSync(target);
      writeFileSync(join(target, 'signing.xcconfig'), 'TEAM=original');
      symlinkSync(target, join(root, 'apps/mobile/ios/Pods/Configuration Alias'), 'dir');
    }
    const aliased = productionSigningInputDigest(roots[0]);
    assert.equal(productionSigningInputDigest(roots[1]), aliased);
    writeFileSync(join(roots[1], 'generated-settings/signing.xcconfig'), 'TEAM=changed');
    assert.notEqual(productionSigningInputDigest(roots[1]), aliased);
    symlinkSync(
      join(roots[1], 'generated-settings'),
      join(roots[1], 'generated-settings/cycle'),
      'dir',
    );
    assert.throws(() => productionSigningInputDigest(roots[1]), /cycle/);
    rmSync(join(roots[1], 'generated-settings/cycle'));
    symlinkSync(roots[0], join(roots[1], 'apps/mobile/ios/Pods/outside'), 'dir');
    assert.throws(() => productionSigningInputDigest(roots[1]), /escapes checkout/);
    rmSync(join(roots[1], 'apps/mobile/ios/Pods/outside'));
    rmSync(join(roots[1], 'apps/mobile/ios/Pods/Manifest.lock'));
    assert.throws(() => productionSigningInputDigest(roots[1]));
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
