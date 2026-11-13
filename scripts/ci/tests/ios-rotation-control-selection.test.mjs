import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { fixture } from './fixtures/ios-test-runner.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';
import { photoDocumentJourney } from '../medical-document-photo-fixture.mjs';
import { duoAcceptanceDiagnosticTests } from '../ios-acceptance-diagnostic-inventory.mjs';
import { resolveIosTestProfileSelection } from '../ios-test-profile-selection.mjs';

// The control never enters the default suite or a different destination.
test('rotation control is admitted only as an explicit single Duo diagnostic', () => {
  const control = 'OrotUITests/TestHostConnectionTests/testSystemBrowserRotationControl';
  const enabled = {
    OROT_IOS_TEST_PHASE: 'rotation-control',
    TEST_RUNNER_OROT_ROTATION_CONTROL: 'YES',
  };
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
  ])
    assert.ok(!iosTestInventory(profile).includes(control));
  for (const [profile, selected, env, accepted] of [
    ['duo', [control], enabled, true],
    ['duo', [control], {}, false],
    ['core', [control], enabled, false],
    ['core', [control], { TEST_RUNNER_OROT_ROTATION_CONTROL: 'YES' }, false],
    ['duo', [control, hostConnectionTest], enabled, false],
  ]) {
    const run = fixture(0, profile, 'all', selected, env);
    try {
      assert.equal(run.outcome.status === 0, accepted, run.outcome.stderr);
      assert.equal(
        run.calls.some((call) => call.name === 'xcodebuild'),
        accepted,
      );
    } finally {
      rmSync(run.directory, { recursive: true, force: true });
    }
  }
});

test('UIKit calibration is admitted only as an explicit single Duo diagnostic', () => {
  const calibration = 'OrotUITests/TestHostConnectionTests/testUIKitCalibrationRotationControl';
  const enabled = {
    OROT_IOS_TEST_PHASE: 'rotation-calibration',
    TEST_RUNNER_OROT_ROTATION_CALIBRATION: 'YES',
  };
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
  ])
    assert.ok(!iosTestInventory(profile).includes(calibration));
  for (const [profile, selected, env, accepted] of [
    ['duo', [calibration], enabled, true],
    ['duo', [calibration], {}, false],
    ['core', [calibration], enabled, false],
    ['duo', [calibration, hostConnectionTest], enabled, false],
    ['duo', [calibration], { ...enabled, TEST_RUNNER_OROT_ROTATION_CONTROL: 'YES' }, false],
  ]) {
    const run = fixture(0, profile, 'all', selected, env);
    try {
      assert.equal(run.outcome.status === 0, accepted, run.outcome.stderr);
      assert.equal(
        run.calls.some((call) => call.name === 'xcodebuild'),
        accepted,
      );
    } finally {
      rmSync(run.directory, { recursive: true, force: true });
    }
  }
});

test('Duo photo validation admits only its explicit single journey', () => {
  const enabled = { TEST_RUNNER_OROT_DUO_PHOTO_VALIDATION: 'YES' };
  assert.ok(!iosTestInventory('duo').includes(photoDocumentJourney));
  for (const [profile, selection, environment, accepted] of [
    ['duo', [photoDocumentJourney], {}, false],
    ['duo', [photoDocumentJourney], enabled, true],
    ['core', [photoDocumentJourney], enabled, false],
    ['duo', [photoDocumentJourney, hostConnectionTest], enabled, false],
    ['duo', [hostConnectionTest], enabled, false],
  ]) {
    const run = fixture(0, profile, 'all', selection, environment);
    try {
      assert.equal(run.outcome.status === 0, accepted, run.outcome.stderr);
      assert.equal(
        run.calls.some((call) => call.name === 'xcodebuild'),
        accepted,
      );
      if (accepted) {
        const seeds = run.calls.filter(
          (call) =>
            call.name === 'xcrun' && call.args[0] === 'simctl' && call.args[1] === 'addmedia',
        );
        assert.equal(seeds.length, 1);
        assert.equal(seeds[0].args[2], 'fixture-udid');
      }
    } finally {
      rmSync(run.directory, { recursive: true, force: true });
    }
  }
});

test('Duo speech diagnostics stay out of the default inventory', () => {
  const [speech] = duoAcceptanceDiagnosticTests;
  assert.ok(!iosTestInventory('duo').includes(speech));
  assert.doesNotThrow(() => resolveIosTestProfileSelection('duo', [speech]));
  assert.throws(() => resolveIosTestProfileSelection('core', [speech]), /Duo acceptance/);
  assert.throws(
    () => resolveIosTestProfileSelection('duo', [speech, hostConnectionTest]),
    /Duo acceptance/,
  );
});

test('medical document journeys are explicit single-case Duo diagnostics', () => {
  const documentTests = [
    'OrotUITests/MedicalDocumentPickerRecoveryUITests/testPhotoPickerCancelRestoresInteraction',
    'OrotUITests/MedicalDocumentImportJourneyUITests/testTextBasedPdfCanBeReviewedSavedAndOpenedWithProvenance',
  ];
  for (const identifier of documentTests) {
    assert.ok(!iosTestInventory('duo').includes(identifier));
    assert.deepEqual(resolveIosTestProfileSelection('duo', [identifier]), {
      fixtureSelection: null,
      hostPreparation: false,
      isFixtureProfile: false,
    });
    for (const profile of ['fixtures', 'health-import']) {
      assert.ok(iosTestInventory(profile).includes(identifier));
      assert.deepEqual(resolveIosTestProfileSelection(profile, [identifier]), {
        fixtureSelection: profile,
        hostPreparation: false,
        isFixtureProfile: true,
      });
      const fixtureRun = fixture(0, profile, 'all', [identifier]);
      try {
        assert.equal(fixtureRun.outcome.status, 0, fixtureRun.outcome.stderr);
        const testRun = fixtureRun.calls.find((call) => call.name === 'xcodebuild');
        assert.ok(testRun);
        assert.ok(testRun.args.includes('-only-testing:' + identifier));
      } finally {
        rmSync(fixtureRun.directory, { recursive: true, force: true });
      }
    }
    const run = fixture(0, 'duo', 'all', [identifier]);
    try {
      assert.equal(run.outcome.status, 0, run.outcome.stderr);
      const testRun = run.calls.find((call) => call.name === 'xcodebuild');
      assert.ok(testRun);
      assert.ok(testRun.args.includes('-only-testing:' + identifier));
    } finally {
      rmSync(run.directory, { recursive: true, force: true });
    }
    assert.throws(() => resolveIosTestProfileSelection('core', [identifier]), /Duo acceptance/);
    assert.throws(
      () => resolveIosTestProfileSelection('duo', [identifier, hostConnectionTest]),
      /Duo acceptance/,
    );
  }
});
