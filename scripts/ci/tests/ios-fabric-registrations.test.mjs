import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fabricRegistrationReceipt } from '../verify-ios-fabric-registrations.mjs';

import { mapping, provider } from './fixtures/ios-fabric-provider.mjs';

test('requires known mappings but accepts unrelated count changes', () => {
  const base = fabricRegistrationReceipt(provider(mapping));
  const extra = '@"ExtraView": NSClassFromString(@"ExtraClass"), // @scope/extra';
  const next = fabricRegistrationReceipt(provider([...mapping, extra]));
  assert.equal(base.count, 5);
  assert.equal(next.count, 6);
  assert.notEqual(base.sha256, next.sha256);
});

test('fails closed on absent, empty or ambiguous generated dictionaries', () => {
  assert.throws(
    () => fabricRegistrationReceipt(''),
    /Unexpected generated Fabric provider structure/,
  );
  assert.throws(() => fabricRegistrationReceipt(provider([])), /Empty/);
  assert.throws(
    () => fabricRegistrationReceipt(provider(mapping).repeat(2)),
    /Malformed Fabric registration/,
  );
});

test('rejects repeated, malformed, missing and incorrectly owned registrations', () => {
  assert.throws(() => fabricRegistrationReceipt(provider([...mapping, mapping[0]])), /Duplicate/);
  assert.throws(() => fabricRegistrationReceipt(provider([...mapping, '// decoy'])), /Malformed/);
  assert.throws(
    () => fabricRegistrationReceipt(provider(mapping.slice(1))),
    /required Fabric registration: RNSScreen/,
  );
  assert.throws(
    () =>
      fabricRegistrationReceipt(
        provider(mapping.map((line) => line.replace('RNSScreenView', 'OtherClass'))),
      ),
    /required Fabric registration: RNSScreen/,
  );
  assert.throws(
    () =>
      fabricRegistrationReceipt(
        provider(mapping.map((line) => line.replace('react-native-screens', 'unrelated-owner'))),
      ),
    /required Fabric registration: RNSScreen/,
  );
});

test('rejects comment, inactive preprocessor and alternate method decoys', () => {
  const actual = provider(mapping);
  const empty = provider([]);
  assert.throws(() => fabricRegistrationReceipt('/*\n' + actual + '*/\n'), /structure/);
  assert.throws(() => fabricRegistrationReceipt('#if 0\n' + actual + '#endif\n'), /structure/);
  assert.throws(() => fabricRegistrationReceipt(empty + '/*\n' + actual + '*/\n'), /structure/);
  assert.throws(
    () =>
      fabricRegistrationReceipt(
        actual.replace('thirdPartyFabricComponents', 'decoyFabricComponents'),
      ),
    /structure/,
  );
  assert.throws(
    () =>
      fabricRegistrationReceipt(
        actual.replace(
          '    thirdPartyComponents = @{',
          '    /* disabled */ thirdPartyComponents = @{',
        ),
      ),
    /structure/,
  );
  assert.throws(
    () => fabricRegistrationReceipt(provider(['#if 0', ...mapping, '#endif'])),
    /Malformed/,
  );
});

test('canonical app-host build verifies the generated source only after successful Xcode', () => {
  const wrapper = readFileSync(new URL('../build-ios-tests.mjs', import.meta.url), 'utf8');
  assert.equal(wrapper.match(/verifyIosFabricProvider\(\);/g)?.length, 1);
  assert.ok(
    wrapper.indexOf('await new Promise') <
      wrapper.indexOf('if (xcodeStatus === 0) verifyIosFabricProvider();'),
  );
  assert.match(wrapper, /if \(xcodeStatus === 0\) verifyIosFabricProvider\(\);/);
});
