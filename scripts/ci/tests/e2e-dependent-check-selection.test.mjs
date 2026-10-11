import assert from 'node:assert/strict';
import test from 'node:test';
import { selectChecksForPaths } from '../changed-paths-select.mjs';

// Keep E2E support files aligned with the app unit and CI policy tests that consume them.
const unitConsumedE2EPaths = [
  'apps/mobile/e2e/backupContainerSnapshot.js',
  'apps/mobile/e2e/backupProbePreparation.ts',
  'apps/mobile/e2e/backupProbeTypes.ts',
  'apps/mobile/e2e/nextVisitProbeDiagnostics.js',
  'apps/mobile/e2e/providerSelectionSystemConsent.js',
  'apps/mobile/e2e/transcription/fixtures/synthetic-korean.json',
  'apps/mobile/e2e/transcription/transcriptDeletionDetoxHelpers.js',
  'apps/mobile/e2e/transcription/transcriptDeletionProbeSupport.ts',
  'apps/mobile/e2e/transcription/transcriptEvidenceDetoxHelpers.js',
  'apps/mobile/e2e/transcription/transcriptEvidenceProbeSupport.ts',
  'apps/mobile/e2e/transcription/transcriptEvidenceProbe.ts',
  'apps/mobile/e2e/unifiedImportProbeMeasurements.ts',
];

test('E2E helpers and fixtures consumed by app unit tests select Unit Test', () => {
  for (const path of unitConsumedE2EPaths) {
    const selection = selectChecksForPaths([path]);

    assert.equal(selection.unit_tests, true, path);
    assert.equal(selection.policy_tests, true, path);
  }
});

test('E2E policy inputs select policy checks without unrelated unit tests', () => {
  const selection = selectChecksForPaths(['apps/mobile/e2e/release-e2e-shards.js']);

  assert.equal(selection.policy_tests, true);
  assert.equal(selection.detox_release, true);
  assert.equal(selection.unit_tests, false);
});

test('Navigation Glass stays Release-only while retaining E2E policy coverage', () => {
  const selection = selectChecksForPaths(['apps/mobile/e2e/navigation-glass.e2e.js']);
  const selectedProfiles = Object.keys(selection)
    .filter((key) => key.startsWith('detox_') && selection[key])
    .sort();

  assert.deepEqual(selectedProfiles, ['detox_release']);
  assert.equal(selection.policy_tests, true);
  assert.equal(selection.unit_tests, false);
});
