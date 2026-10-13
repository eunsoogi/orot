import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('each hosted Speech consumer verifies actual assets before its first recognition without retrying a fixture', () => {
  const source = readFileSync('.github/workflows/ios-test-validation.yml', 'utf8');
  const start = source.indexOf(
    '      - name: Install Korean Speech assets without recognizing a fixture',
  );
  const end = source.indexOf('      - name: Execute without compilation or retry', start);
  assert.ok(start > source.indexOf('Verify product provenance and integrity'));
  assert.ok(end > start);
  const step = source.slice(start, end);
  assert.match(step, /if: matrix\.profile == 'speech'/);
  const identifiers = step.match(/OrotIntegrationTests\/SpeechAssetPreparationTests\/\w+/g);
  assert.deepEqual([...new Set(identifiers)], iosTestInventory('speech', 'preparation'));
  assert.equal(identifiers.length, 2);
  assert.match(step, /run-ios-tests\.mjs speech/);
  assert.match(step, /ios-test-results\.mjs speech/);
  assert.ok(!step.includes('continue-on-error') && !step.includes('retry'));
  assert.ok(!step.includes('testMedicationFixture') && !step.includes('SpeechJourneyUITests'));
  assert.match(source, /artifacts\/ios-tests\/\*\.xcresult/);
});
