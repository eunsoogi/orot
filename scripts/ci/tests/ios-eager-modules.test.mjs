import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertIosEagerModules } from '../verify-ios-eager-modules.mjs';

import { eagerCore as core, eagerProvider as registry } from './fixtures/ios-eager-provider.mjs';

test('iOS generated eager registry excludes absent RNTester module and retains prebuilt core', () => {
  assert.doesNotThrow(() => assertIosEagerModules(registry(core)));
  assert.doesNotThrow(() => assertIosEagerModules(registry([...core, 'OtherRegisteredModule'])));
  assert.throws(() => assertIosEagerModules(registry([...core, 'SampleTurboModule'])));
  assert.throws(() => assertIosEagerModules(registry(core.slice(1))));
});
