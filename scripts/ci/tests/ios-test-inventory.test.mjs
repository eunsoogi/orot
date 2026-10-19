import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('separate Core and Speech runners cover every registered boundary without duplication or silent subsets', () => {
  // Target boundaries stop dependent UI work while preserving the full original inventory.
  for (const [profile, integrationCount, uiCount] of [
    ['core', 20, 6],
    ['speech', 6, 1],
  ]) {
    const all = iosTestInventory(profile);
    const integration = iosTestInventory(profile, 'integration');
    const ui = iosTestInventory(profile, 'ui');
    assert.equal(integration.length, integrationCount);
    assert.equal(ui.length, uiCount);
    const remaining =
      profile === 'speech'
        ? iosTestInventory(profile, 'journey').slice(1)
        : [
            ...iosTestInventory(profile, 'isolation'),
            ...iosTestInventory(profile, 'recording-persistence'),
            ...iosTestInventory(profile, 'state-persistence'),
          ];
    assert.deepEqual([...integration, ...ui, ...remaining].sort(), [...all].sort());
    assert.equal(new Set([...integration, ...ui, ...remaining]).size, all.length);
    assert.ok(integration.every((id) => id.startsWith('OrotIntegrationTests/')));
    assert.ok(ui.every((id) => id.startsWith('OrotUITests/')));
  }
  assert.equal(iosTestInventory('speech', 'preparation').length, 1);
  for (const identifier of [
    'OrotIntegrationTests/ProgressIndicatorIntegrationTests/testAnimationFollowsWindowAndRequestLifetime',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testRootTabAccessibilityKeepsDisabledAndSelectedTraitsTogether',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testBackAndHomeNeverExposeRootTabSelectionToAccessibility',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testPrimaryNavigationActionsKeepTheirMinimumNativeTargetSize',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testContextualPrimaryActionPreservesButtonIdentityAcrossSaveStateUpdates',
  ])
    assert.ok(iosTestInventory('core', 'integration').includes(identifier), identifier);
  assert.ok(
    iosTestInventory('core', 'ui').includes(
      'OrotUITests/RootNavigationUITests/testContextualNavigationRemainsAboveKeyboardAndHomeDismissesIt',
    ),
  );
  assert.throws(() => iosTestInventory('core', 'preparation'));
  assert.throws(() => iosTestInventory('core', 'journey'));
  assert.throws(() => iosTestInventory('speech', 'unknown'));
  assert.throws(() => iosTestInventory('provider-data', 'ui'));
});

test('each profile declares unique existing cases and every test method is scheduled', () => {
  const seen = new Set();
  for (const profile of [
    'core',
    'speech',
    'provider-data',
    'backup',
    'fixtures',
    'health-import',
    'microphone',
    'local-model',
    'provider-selection',
  ]) {
    const inventory = iosTestInventory(profile);
    assert.ok(inventory.length > 0);
    assert.equal(new Set(inventory).size, inventory.length);
    for (const identifier of inventory) {
      seen.add(identifier);
      const [target, suite, method] = identifier.split('/');
      const source = readFileSync(`apps/mobile/ios/${target}/${suite}.swift`, 'utf8');
      assert.ok(source.includes(`func ${method}(`), identifier);
    }
  }
  for (const identifier of iosTestInventory('speech', 'preparation')) {
    seen.add(identifier);
    const [target, suite, method] = identifier.split('/');
    const source = readFileSync(`apps/mobile/ios/${target}/${suite}.swift`, 'utf8');
    assert.ok(source.includes(`func ${method}(`), identifier);
  }
  for (const target of ['OrotIntegrationTests', 'OrotUITests']) {
    for (const file of readdirSync(`apps/mobile/ios/${target}`).filter((file) =>
      file.endsWith('.swift'),
    )) {
      const source = readFileSync(`apps/mobile/ios/${target}/${file}`, 'utf8');
      for (const match of source.matchAll(/func (test\w+)\(/g))
        assert.ok(
          seen.has(`${target}/${file.slice(0, -6)}/${match[1]}`),
          `Unscheduled test ${file}/${match[1]}`,
        );
    }
  }
  assert.throws(() => iosTestInventory('unknown'));
});
