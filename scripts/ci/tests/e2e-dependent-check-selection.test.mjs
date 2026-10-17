import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { selectChecksForPaths } from '../changed-paths-select.mjs';

// Keep E2E support files aligned with the app unit and CI policy tests that consume them.
const unitConsumedE2EPaths = [
  'apps/mobile/e2e/appleModelMockFixtures.ts',
  'apps/mobile/e2e/domainTestOperations.ts',
  'apps/mobile/e2e/testRoute.ts',
  'apps/mobile/e2e/testApplicationRenderer.ts',
  'apps/mobile/e2e/automaticTranscriptionProbeSupport.ts',
  'apps/mobile/e2e/retrievalCorpusPersistence.ts',
  'apps/mobile/e2e/backupContainerSnapshot.js',
  'apps/mobile/e2e/backupProbePreparation.ts',
  'apps/mobile/e2e/backupProbeTypes.ts',
  'apps/mobile/e2e/transcription/fixtures/synthetic-korean.json',
  'apps/mobile/e2e/transcription/transcriptDeletionProbeSupport.ts',
  'apps/mobile/e2e/transcription/transcriptEvidenceProbeSupport.ts',
  'apps/mobile/e2e/transcription/transcriptEvidenceProbe.tsx',
  'apps/mobile/e2e/unifiedImportProbeMeasurements.ts',
];

test('E2E helpers and fixtures consumed by app unit tests select Unit Test', () => {
  for (const path of unitConsumedE2EPaths) {
    assert.equal(existsSync(new URL('../../../' + path, import.meta.url)), true, path);
    const selection = selectChecksForPaths([path]);

    assert.equal(selection.unit_tests, true, path);
    assert.equal(selection.policy_tests, true, path);
  }
});

test('app test entries preserve the unit boundary even without a direct current import', () => {
  const selection = selectChecksForPaths(['apps/mobile/e2e/calendarProbeEntry.tsx']);

  assert.equal(selection.policy_tests, true);
  assert.equal(selection.ios_tests, true);
  assert.equal(selection.unit_tests, true);
});

test('navigation test entry retains the full iOS gate and policy coverage', () => {
  const selection = selectChecksForPaths(['apps/mobile/e2e/navigationTestEntry.tsx']);

  assert.equal(selection.ios_tests, true);
  assert.equal(selection.policy_tests, true);
  assert.equal(selection.unit_tests, true);
});
