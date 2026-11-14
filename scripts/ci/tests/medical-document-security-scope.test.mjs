import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  medicalDocumentCoreTests,
  medicalDocumentSecurityTests,
  medicalDocumentProtectionTests,
} from '../medical-document-test-inventory.mjs';
import { medicalDocumentSecurityArguments } from '../medical-document-security-validation.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { verifyIosObservationList } from '../ios-test-results.mjs';

test('hosted plan retains reads/picker and user journeys, separating only protected-store integration', () => {
  const hosted = iosTestExecutionPlan().flatMap((entry) =>
    iosTestCohortTasks(entry.cohort).flatMap((task) => task.identifiers),
  );
  assert.equal(medicalDocumentCoreTests.length, 11);
  assert.equal(medicalDocumentSecurityTests.length, 20);
  assert.equal(medicalDocumentProtectionTests.length, 13);
  for (const id of medicalDocumentCoreTests) assert.ok(hosted.includes(id));
  for (const id of medicalDocumentProtectionTests) assert.ok(!hosted.includes(id));
  for (const suite of [
    'MedicalDocumentImportJourneyUITests',
    'MedicalDocumentPhotoJourneyUITests',
    'MedicalDocumentPickerRecoveryUITests',
  ])
    assert.ok(hosted.some((id) => id.includes(`/${suite}/`)));
  const args = medicalDocumentSecurityArguments(
    'build.xctestrun',
    'id=owned-device',
    'security.xcresult',
  );
  assert.deepEqual(
    args.filter((arg) => arg.startsWith('-only-testing:')).map((arg) => arg.slice(14)),
    medicalDocumentSecurityTests,
  );
  assert.ok(!args.some((arg) => /skip|retry/.test(arg)));
});

test('security completeness cannot accept missing, skipped or failed original assertions', () => {
  const passed = medicalDocumentSecurityTests.map((identifier) => ({
    identifier,
    result: 'Passed',
  }));
  assert.equal(verifyIosObservationList(passed, medicalDocumentSecurityTests).length, 20);
  assert.throws(() => verifyIosObservationList(passed.slice(1), medicalDocumentSecurityTests));
  for (const result of ['Skipped', 'Failed', 'Unavailable'])
    assert.throws(() =>
      verifyIosObservationList(
        [{ ...passed[0], result }, ...passed.slice(1)],
        medicalDocumentSecurityTests,
      ),
    );
});

test('native capability gate checks the actual owned root and only skips explicit unsupported', () => {
  const photo = readFileSync(
    'apps/mobile/ios/OrotIntegrationTests/MedicalDocumentOriginalPhotoTests.swift',
    'utf8',
  );
  assert.match(photo, /createDirectory\(at: url, withIntermediateDirectories: true\)/);
  assert.match(
    photo,
    /\(url as NSURL\)\.resourceValues\(forKeys: \[\.volumeSupportsFileProtectionKey\]\)/,
  );
  assert.match(photo, /try XCTUnwrap\(values\[\.volumeSupportsFileProtectionKey\] as\? NSNumber/);
  assert.match(photo, /if !supported.boolValue \{\s*throw XCTSkip\("Environment unsupported:/);
  assert.equal(
    (photo.match(/try requireMedicalDocumentProtectionSupport\(root\)/g) ?? []).length,
    5,
  );
  const operations = readFileSync(
    'apps/mobile/ios/OrotIntegrationTests/MedicalDocumentFileOperationsTests.swift',
    'utf8',
  );
  assert.equal(
    (operations.match(/try requireMedicalDocumentProtectionSupport\(root\)/g) ?? []).length,
    6,
  );
  const weak = operations
    .split('func testKnownWeakerProtectionIsRejected')[1]
    .split('func testDuplicateSourceRecovery')[0];
  assert.ok(!weak.includes('requireMedicalDocumentProtectionSupport'));
  assert.ok(weak.includes('XCTAssertThrowsError'));
});
