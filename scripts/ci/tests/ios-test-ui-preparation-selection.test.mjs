import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestCohortTasks, iosTestTaskNeedsUiPreparation } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { selectFocusedIosTests } from '../ios-focused-selection.mjs';

const fixtureFile = 'scripts/ci/ios-test-fixture-groups.mjs';

test('full cohort plans and focused selections agree on UI preparation for every UI task family', () => {
  const planCohorts = iosTestExecutionPlan().map(({ cohort }) => cohort);
  const uiCohorts = new Set([
    'core-ui',
    'recording-evidence',
    'backup',
    'navigation-features',
    'navigation-routes',
    'navigation-accessibility',
    'navigation-imports',
    'recordings',
    'questions-review',
    'questions-conversation',
    'questions-summary',
    'calendar-consent',
    'calendar-appointments',
    'health',
    'microphone',
    'selection',
    'speech',
  ]);
  for (const cohort of planCohorts)
    assert.equal(
      iosTestCohortTasks(cohort).some(iosTestTaskNeedsUiPreparation),
      uiCohorts.has(cohort),
      `${cohort} preparation must follow its planned UI task target`,
    );
  for (const suite of ['navigation', 'recordings', 'questions', 'calendar']) {
    const [task] = iosTestCohortTasks(suite);
    const selection = selectFocusedIosTests('ios/fixtures', fixtureFile, `group/${suite}`);
    assert.deepEqual(selection.identifiers, task.identifiers);
    assert.equal(selection.prepareUi, iosTestTaskNeedsUiPreparation(task));
    assert.equal(selection.prepareUi, true);
  }

  const [coreUi] = iosTestCohortTasks('core-ui');
  const [coreUiIdentifier] = coreUi.identifiers;
  const [target, classAndMethod] = coreUiIdentifier.split('/');
  const [testClass] = classAndMethod.split('/');
  const coreFocus = selectFocusedIosTests(
    'ios/core',
    `apps/mobile/ios/${target}/${testClass}.swift`,
    coreUiIdentifier,
  );
  assert.equal(coreFocus.prepareUi, iosTestTaskNeedsUiPreparation(coreUi));

  const [backup] = iosTestCohortTasks('backup');
  const [backupIdentifier] = backup.identifiers;
  const [backupTarget, backupClassAndMethod] = backupIdentifier.split('/');
  const [backupClass] = backupClassAndMethod.split('/');
  const backupFocus = selectFocusedIosTests(
    'ios/backup',
    `apps/mobile/ios/${backupTarget}/${backupClass}.swift`,
    'all',
  );
  assert.deepEqual(backupFocus.identifiers, backup.identifiers);
  assert.equal(backupFocus.prepareUi, iosTestTaskNeedsUiPreparation(backup));

  const [speechJourney] = iosTestCohortTasks('speech').filter((task) => task.suite === 'journey');
  const speechFocus = selectFocusedIosTests(
    'ios/speech',
    'scripts/ci/speech-journey-test-phases.mjs',
    'group/journey',
  );
  assert.deepEqual(speechFocus.identifiers, speechJourney.identifiers);
  assert.equal(speechFocus.prepareUi, iosTestTaskNeedsUiPreparation(speechJourney));
  for (const cohort of ['health', 'microphone', 'selection']) {
    const [task] = iosTestCohortTasks(cohort);
    const [identifier] = task.identifiers;
    const [target, classAndMethod] = identifier.split('/');
    const [testClass] = classAndMethod.split('/');
    const selection = selectFocusedIosTests(
      `ios/${task.profile}`,
      `apps/mobile/ios/${target}/${testClass}.swift`,
      identifier,
    );
    assert.equal(selection.prepareUi, iosTestTaskNeedsUiPreparation(task));
  }
  assert.equal(iosTestTaskNeedsUiPreparation(iosTestCohortTasks('core-integration')[0]), false);
  assert.equal(iosTestTaskNeedsUiPreparation(iosTestCohortTasks('persistence')[0]), false);
});
