import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertIosEagerModules } from '../verify-ios-eager-modules.mjs';

const registry = (names) => `@implementation RCTUnstableModulesRequiringMainQueueSetupProvider

+(NSArray<NSString *> *)modules
{
  return @[
    ${names.map((name) => '@"' + name + '"').join(',\n\t\t')}
  ];
}

@end
`;

test('iOS generated eager registry excludes absent RNTester module and retains prebuilt core', () => {
  const core = [
    'AccessibilityManager',
    'Appearance',
    'AppState',
    'DeviceInfo',
    'PlatformConstants',
    'StatusBarManager',
  ];
  assert.doesNotThrow(() => assertIosEagerModules(registry(core)));
  assert.doesNotThrow(() => assertIosEagerModules(registry([...core, 'OtherRegisteredModule'])));
  assert.throws(() => assertIosEagerModules(registry([...core, 'SampleTurboModule'])));
  assert.throws(() => assertIosEagerModules(registry(core.slice(1))));
});
