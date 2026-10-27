import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestBuildSpec, iosTestConfig } from '../ios-test-config.mjs';
import { iosTestCohortTasks, verifyIosSimulatorOwnerContract } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

// These contracts protect existing jobs while the opt-in profile owns a separate native destination.
test('Duo selects its supported runtime without changing SDK or ordinary destinations', () => {
  const duo = iosTestConfig('duo');
  assert.equal(duo.device, 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo');
  assert.equal(duo.runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-27-1');
  assert.equal(duo.runtimeBuild, null);
  assert.equal(duo.configuration, 'Release');
  for (const profile of [
    'duo',
    'core',
    'speech',
    'backup',
    'fixtures',
    'local-model',
    'provider-data',
    'health-import',
    'microphone',
    'provider-selection',
  ]) {
    const config = iosTestConfig(profile);
    assert.equal(config.xcode, '27.1');
    assert.equal(config.sdk, '27.1');
    if (profile === 'duo') continue;
    const speech = profile === 'speech';
    assert.equal(
      config.runtime,
      `com.apple.CoreSimulator.SimRuntime.iOS-${speech ? '26-2' : '27-0'}`,
    );
    assert.equal(config.runtimeBuild, speech ? '23C54' : null);
    assert.equal(
      config.device,
      `com.apple.CoreSimulator.SimDeviceType.${speech ? 'iPhone-SE-3rd-generation' : 'iPhone-18-Pro'}`,
    );
    assert.equal(
      config.configuration,
      ['provider-data', 'health-import', 'microphone', 'provider-selection'].includes(profile)
        ? 'Debug'
        : 'Release',
    );
  }
});

test('Duo remains opt-in with its own product compatibility and exact native test inventory', () => {
  const duo = iosTestBuildSpec('duo');
  const core = iosTestBuildSpec('core');
  assert.equal(duo.productProfile, 'ios-test-duo');
  assert.deepEqual(duo.compatibleExecutions, ['duo']);
  assert.deepEqual(core.compatibleExecutions, [
    'core',
    'speech',
    'backup',
    'fixtures',
    'local-model',
  ]);
  assert.deepEqual(iosTestBuildSpec('provider-data').compatibleExecutions, [
    'provider-data',
    'health-import',
    'microphone',
    'provider-selection',
  ]);
  const buildInputs = (spec) =>
    Object.fromEntries(
      Object.entries(spec).filter(
        ([key]) => !['productProfile', 'compatibleExecutions'].includes(key),
      ),
    );
  assert.deepEqual(buildInputs(duo), buildInputs(core));
  const duoInventory = iosTestInventory('duo');
  const iPhoneFixtures = iosTestInventory('fixtures');
  const coreTests = iosTestInventory('core');
  const contextualDeparture =
    'OrotUITests/ManualHistoryUITests/testContextualBackAndHomeHonorDepartureConfirmationInRightRail';
  const duoKeyboardSave =
    'OrotUITests/NextVisitReviewUITests/testDuoRightRailKeepsKeyboardSaveInsideTheContentLane';
  const fourSidedOcclusion =
    'OrotUITests/SafeAreaNavigationUITests/testSystemInsetsAcrossHomeHealthImportRecordingAndBloodPressureLibrary';
  const scheduleReflow =
    'OrotUITests/ScheduleCalendarUITests/testSelectedAppointmentSurvivesDarkLandscapeReflowAndConfirmation';
  const scheduleLargeText =
    'OrotUITests/ScheduleCalendarUITests/testLargeTextKeepsScheduleConfirmationReachable';
  const recordingShareDismissal =
    'OrotUITests/RecordingExportUITests/testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource';
  const standardKeyboardSave =
    'OrotUITests/NextVisitReviewUITests/testSaveRemainsAboveTheActualKeyboardWhileEditingTheThirdQuestion';
  assert.equal(duoInventory.length, 10);
  assert.deepEqual(duoInventory, [
    'OrotUITests/TestHostConnectionTests/testHostLaunches',
    'OrotUITests/RootNavigationUITests/testRightRailKeepsAccessibleRootAndContextualNavigation',
    'OrotUITests/WindowGeometryUITests/testDuoGeometryEventsMatchUIKitAndRetainQuestionDraftAcrossSourceNavigation',
    'OrotUITests/OrientationPresentationAnchorUITests/testLandscapeTransitionRetainsQuestionDraftAndSourceRoute',
    scheduleReflow,
    scheduleLargeText,
    contextualDeparture,
    duoKeyboardSave,
    fourSidedOcclusion,
    recordingShareDismissal,
  ]);
  // Keep the iPhone cohorts intact while scheduling the same native regressions on the separate Duo destination.
  assert.ok(iPhoneFixtures.includes(standardKeyboardSave));
  assert.ok(iPhoneFixtures.includes(scheduleReflow));
  assert.ok(iPhoneFixtures.includes(scheduleLargeText));
  assert.ok(iPhoneFixtures.includes(fourSidedOcclusion));
  assert.ok(coreTests.includes(recordingShareDismissal));
  const navigationImports = iosTestCohortTasks('navigation-imports').flatMap(
    (task) => task.identifiers,
  );
  const recordingEvidence = iosTestCohortTasks('recording-evidence').flatMap(
    (task) => task.identifiers,
  );
  assert.ok(navigationImports.includes(fourSidedOcclusion));
  assert.ok(recordingEvidence.includes(recordingShareDismissal));
  assert.ok(!duoInventory.includes(standardKeyboardSave));
  assert.ok(!iPhoneFixtures.includes(contextualDeparture));
  assert.ok(!iPhoneFixtures.includes(duoKeyboardSave));
  assert.ok(!coreTests.includes(contextualDeparture));
  assert.ok(!coreTests.includes(duoKeyboardSave));
  assert.ok(
    coreTests.includes(
      'OrotIntegrationTests/NavigationLayoutIntegrationTests/testContextualDisabledAccessibilityTracksUIKitStateWithoutTabSelection',
    ),
  );
  assert.throws(() => iosTestInventory('duo', 'integration'), /Unsupported/);
  assert.throws(() => iosTestInventory('duo', 'navigation'), /Unsupported/);
  assert.ok(iosTestExecutionPlan().every((job) => job.profile !== 'duo'));
});

test('Duo ownership cannot reuse an ordinary iPhone, runtime or cohort receipt', () => {
  const owner = { ...iosTestConfig('duo'), name: 'owned-duo', udid: 'owned-duo-udid' };
  assert.deepEqual(verifyIosSimulatorOwnerContract(owner, 'duo'), iosTestConfig('duo'));
  for (const change of [
    { device: iosTestConfig('core').device },
    { runtime: iosTestConfig('core').runtime },
    { profile: 'core' },
    { cohort: 'core-ui', profiles: ['core'] },
  ]) {
    assert.throws(
      () => verifyIosSimulatorOwnerContract({ ...owner, ...change }, 'duo'),
      /mismatch/,
    );
  }
  assert.throws(() => verifyIosSimulatorOwnerContract(owner, 'core'), /mismatch/);
});
