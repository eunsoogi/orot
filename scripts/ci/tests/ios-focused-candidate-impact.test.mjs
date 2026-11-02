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
