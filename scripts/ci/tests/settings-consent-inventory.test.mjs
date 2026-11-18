import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

// New persistence acceptance extends Selection without displacing the existing auth diagnostic phase.
test('settings consent persistence stays registered after the original authentication case', () => {
  const selection = iosTestInventory('provider-selection');
  assert.equal(
    selection[0],
    'OrotUITests/ProviderSelectionUITests/testAuthSessionCancellationRouteExitRetryAndCallbackKeepSelectionExplicit',
  );
  const consent =
    'OrotUITests/SettingsConsentUITests/testExplicitThreeTabGrantsAndRevocationSurviveProcessRestart';
  assert.equal(selection.filter((identifier) => identifier === consent).length, 1);
  assert.ok(
    readFileSync('apps/mobile/ios/OrotUITests/SettingsConsentUITests.swift', 'utf8').includes(
      'func ' + consent.split('/')[2] + '()',
    ),
  );
});
