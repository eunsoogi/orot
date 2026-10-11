import assert from 'node:assert/strict';
import test from 'node:test';
import { readApplicationVersion } from '../application-version.mjs';

function reader(rootVersion, marketingVersions) {
  const files = {
    'package.json': JSON.stringify({ version: rootVersion }),
    'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj': marketingVersions
      .map((version) => `MARKETING_VERSION = ${version};`)
      .join('\n'),
  };
  return (path) => files[path];
}

test('uses the root product version when both iOS configurations match it', () => {
  assert.equal(readApplicationVersion(reader('0.1.0', ['0.1.0', '0.1.0'])), '0.1.0');
});

test('fails closed when root or iOS marketing version metadata disagrees', () => {
  assert.throws(() => readApplicationVersion(reader('0.1.0', ['0.1.0', '0.2.0'])), /do not agree/);
  assert.throws(() => readApplicationVersion(reader('0.1.0', ['0.0.1', '0.0.1'])), /do not agree/);
  assert.throws(() => readApplicationVersion(reader('v0.1.0', ['v0.1.0'])), /without a v prefix/);
});
