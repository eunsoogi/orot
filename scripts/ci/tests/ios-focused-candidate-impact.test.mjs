import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyFocusedCandidateImpact } from '../ios-focused-candidate-impact.mjs';
import { selectFocusedIosTests } from '../ios-focused-selection.mjs';

test('candidate impact admits a complete stateful cohort and rejects a partial or unknown selection', () => {
  const path = 'apps/mobile/ios/OrotUITests/BackupPersistenceUITests.swift';
  const selection = selectFocusedIosTests('ios/backup', path, 'all');
  const impacts = verifyFocusedCandidateImpact([path], selection);
  assert.equal(impacts[0].reason, 'backup-ui-test');
  assert.throws(
    () =>
      verifyFocusedCandidateImpact([path], {
        ...selection,
        identifiers: selection.identifiers.slice(1),
      }),
    /does not cover/,
  );
  assert.throws(
    () => verifyFocusedCandidateImpact([path, 'scripts/ci/run-ios-focused-tests.sh'], selection),
    /shared impact is unknown/,
  );
  assert.throws(
    () => verifyFocusedCandidateImpact(['apps/mobile/ios/OrotTestSupport/Shared.swift'], selection),
    /does not cover/,
  );
});

test('maintained literature cases and Jest entries retain their separate impact', () => {
  const path = 'apps/mobile/ios/OrotUITests/SummaryAndLiteratureUITests.swift';
  const selection = selectFocusedIosTests(
    'ios/fixtures',
    'scripts/ci/ios-test-fixture-groups.mjs',
    'group/questions',
  );
  const jest = [
    'apps/mobile/src/externalMedicalEvidence/__tests__/ExternalMedicalEvidenceReadingFlow.test.tsx',
    'apps/mobile/src/externalMedicalEvidence/__tests__/LiteratureRouteLifecycle.test.tsx',
  ];
  const impacts = verifyFocusedCandidateImpact(
    [path, ...jest, 'docs/ios-validation.md'],
    selection,
  );
  assert.deepEqual(impacts[0].cohorts, ['questions-summary', 'questions-literature']);
  assert.deepEqual(
    impacts.slice(1).map((item) => item.reason),
    ['jest-only', 'jest-only'],
  );
  const missing = selection.identifiers.filter((id) => !id.includes('testLiteratureConsent'));
  assert.throws(
    () => verifyFocusedCandidateImpact([path], { ...selection, identifiers: missing }),
    /does not cover/,
  );
  assert.throws(
    () =>
      verifyFocusedCandidateImpact(
        ['apps/mobile/src/externalMedicalEvidence/__tests__/helper.ts'],
        selection,
      ),
    /does not cover/,
  );
  assert.throws(
    () =>
      verifyFocusedCandidateImpact(
        ['apps/mobile/ios/OrotUITests/UnregisteredUITests.swift'],
        selection,
      ),
    /does not cover/,
  );
  assert.throws(
    () => verifyFocusedCandidateImpact(['packages/domain/src/unknown.ts'], selection),
    /does not cover/,
  );
});
