import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

function assertTestMethodDeclared(identifier) {
  const [target, suite, method] = identifier.split('/');
  const base = `apps/mobile/ios/${target}/${suite}`;
  const sourcePath = ['swift', 'm']
    .map((extension) => `${base}.${extension}`)
    .find((path) => existsSync(path));
  assert.ok(sourcePath, `Missing test source for ${identifier}`);
  const source = readFileSync(sourcePath, 'utf8');
  const declaration = sourcePath.endsWith('.swift') ? `func ${method}(` : `- (void)${method}`;
  assert.ok(source.includes(declaration), identifier);
}

test('separate Core and Speech runners cover every registered boundary without duplication or silent subsets', () => {
  // Target boundaries stop dependent UI work while preserving the full original inventory.
  for (const [profile, integrationCount, uiCount] of [
    ['core', 45, 7],
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
  const authentication = iosTestInventory('core', 'authentication');
  assert.deepEqual(authentication, [
    'OrotIntegrationTests/KeychainAuthenticationIntegrationTests/testKeychainQueryUsesFreshContextAndBlocksProtectedLookupWithoutUi',
    'OrotIntegrationTests/KeychainAuthenticationIntegrationTests/testProtectedKeychainReadUsesPromptedContextAfterBiometricMatch',
  ]);
  assert.ok(authentication.every((identifier) => !iosTestInventory('core').includes(identifier)));
  for (const identifier of [
    'OrotIntegrationTests/ProgressIndicatorIntegrationTests/testAnimationFollowsWindowAndRequestLifetime',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testRootTabAccessibilityKeepsDisabledAndSelectedTraitsTogether',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testBackAndHomeNeverExposeRootTabSelectionToAccessibility',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testPrimaryNavigationActionsKeepTheirMinimumNativeTargetSize',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testContextualPrimaryActionPreservesButtonIdentityAcrossSaveStateUpdates',
  ])
    assert.ok(iosTestInventory('core', 'integration').includes(identifier), identifier);
  assert.ok(
    iosTestInventory('core', 'integration').includes(
      'OrotIntegrationTests/WindowPresentationAnchorIntegrationTests/testBridgeFallbackUsesTheSingleForegroundKeyWindow',
    ),
  );
  assert.ok(
    iosTestInventory('core', 'ui').includes(
      'OrotUITests/RootNavigationUITests/testContextualNavigationRemainsAboveKeyboardAndHomeDismissesIt',
    ),
  );
  assert.throws(() => iosTestInventory('core', 'preparation'));
  assert.throws(() => iosTestInventory('core', 'journey'));
  assert.throws(() => iosTestInventory('speech', 'authentication'));
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
    'duo',
  ]) {
    const inventory = iosTestInventory(profile);
    assert.ok(inventory.length > 0);
    assert.equal(new Set(inventory).size, inventory.length);
    for (const identifier of inventory) {
      seen.add(identifier);
      assertTestMethodDeclared(identifier);
    }
  }
  for (const identifier of iosTestInventory('speech', 'preparation')) {
    seen.add(identifier);
    assertTestMethodDeclared(identifier);
  }
  for (const identifier of iosTestInventory('core', 'authentication')) {
    seen.add(identifier);
    assertTestMethodDeclared(identifier);
  }
  for (const target of ['OrotIntegrationTests', 'OrotUITests']) {
    for (const file of readdirSync(`apps/mobile/ios/${target}`).filter(
      (file) => file.endsWith('.swift') || file.endsWith('.m'),
    )) {
      const source = readFileSync(`apps/mobile/ios/${target}/${file}`, 'utf8');
      const testMethods = file.endsWith('.swift')
        ? source.matchAll(/func (test\w+)\(/g)
        : source.matchAll(/-\s*\(void\)\s*(test\w+)\b/g);
      for (const match of testMethods)
        assert.ok(
          seen.has(`${target}/${file.slice(0, file.lastIndexOf('.'))}/${match[1]}`),
          `Unscheduled test ${file}/${match[1]}`,
        );
    }
  }
  assert.throws(() => iosTestInventory('unknown'));
});
