import assert from 'node:assert/strict';
import test from 'node:test';
import { assertOAuthToolchain } from '../oauth-test-context.mjs';

const compatibleToolchain = {
  xcode: 'Xcode 27.1\nBuild version 27A9275',
  sdk: '27.1',
  platform: 'Darwin',
  architecture: 'arm64',
  developerDirectory: '/Applications/Xcode_27.1.app/Contents/Developer',
};

test('accepts OAuth products only from the pinned Xcode 27.1 toolchain', () => {
  assert.doesNotThrow(() => assertOAuthToolchain(compatibleToolchain));
});

test('reports and rejects OAuth products from the legacy Xcode 27.0 toolchain', () => {
  assert.throws(
    () =>
      assertOAuthToolchain({
        ...compatibleToolchain,
        xcode: 'Xcode 27.0\nBuild version 27A266a',
        sdk: '27.0',
        developerDirectory: '/Applications/Xcode.app/Contents/Developer',
      }),
    (error) => {
      assert.match(error.message, /expected Xcode 27\.1/);
      assert.match(error.message, /iOS Simulator SDK 27\.1/);
      assert.match(error.message, /actual Xcode 27\.0/);
      assert.match(error.message, /iOS Simulator SDK 27\.0/);
      assert.match(error.message, /developer directory \/Applications\/Xcode\.app/);
      return true;
    },
  );
});
