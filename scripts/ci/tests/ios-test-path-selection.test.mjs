import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECK_KEYS } from '../changed-paths-core.mjs';
import { selectChecksForPaths } from '../changed-paths-select.mjs';
import { IOS_TEST_COHORT_NAMES } from '../ios-test-execution-plan.mjs';
import {
  parseNameStatusOutput,
  resolveFullValidationDeferred,
  selectChecksForEvent,
} from '../select-changed-paths.mjs';

const sha = (digit) => digit.repeat(40);

test('recording source selects its full stateful group while a question helper stays focused', () => {
  const recording = selectChecksForPaths(['apps/mobile/src/recording/recordingController.ts']);
  const questions = selectChecksForPaths(['apps/mobile/e2e/next-visit-questions.e2e.js']);

  assert.deepEqual(recording.ios_test_cohorts, [
    'core-integration',
    'core-ui',
    'recording-evidence',
    'persistence',
    'isolation',
    'backup',
    'recordings',
    'microphone',
    'speech',
  ]);
  assert.equal(recording.ios_oauth, false);
  assert.deepEqual(questions.ios_test_cohorts, [
    'core-integration',
    'questions-review',
    'questions-conversation',
    'questions-summary',
    'provider',
  ]);
  assert.equal(questions.ios_build, false);
});

test('documentation avoids E2E allocation and unknown app paths fail safe to the full inventory', () => {
  const docs = selectChecksForPaths(['docs/development.md']);
  const unknown = selectChecksForPaths(['apps/mobile/src/newFeature/NewFeature.tsx']);

  assert.equal(docs.ios_tests, false);
  assert.deepEqual(docs.ios_test_cohorts, []);
  assert.equal(unknown.ios_test_cohorts.length, IOS_TEST_COHORT_NAMES.length);
  assert.equal(unknown.ios_oauth, true);
});

test('deletion keeps its mapped suite and a rename to an unknown native test expands to all suites', () => {
  const deleted = selectChecksForPaths(
    parseNameStatusOutput('D\0apps/mobile/ios/OrotUITests/BackupPersistenceUITests.swift\0'),
  );
  const renamed = selectChecksForPaths(
    parseNameStatusOutput(
      'R100\0apps/mobile/ios/OrotUITests/BackupPersistenceUITests.swift\0apps/mobile/ios/OrotIntegrationTests/NewFeatureTests.swift\0',
    ),
  );

  assert.deepEqual(deleted.ios_test_cohorts, ['backup']);
  assert.equal(renamed.ios_test_cohorts.length, IOS_TEST_COHORT_NAMES.length);
  assert.equal(renamed.ios_oauth, true);
});

test('new unclassified native and E2E tests select every maintained cohort', () => {
  for (const path of [
    'apps/mobile/ios/OrotIntegrationTests/NewFeatureTests.swift',
    'apps/mobile/ios/OrotUITests/NewFeatureUITests.swift',
    'apps/mobile/e2e/newFeatureTestOperation.ts',
  ]) {
    const selection = selectChecksForPaths([path]);

    assert.deepEqual(selection.ios_test_cohorts, IOS_TEST_COHORT_NAMES, path);
    assert.equal(selection.ios_oauth, true, path);
  }
});

test('shared package and E2E scheduling changes select all cohorts and the separate OAuth suite', () => {
  const sharedPackage = selectChecksForPaths([
    'packages/provider-openai/Sources/OAuth/Session.swift',
  ]);
  const workflow = selectChecksForPaths(['.github/workflows/e2e-test.yml']);

  assert.deepEqual(sharedPackage.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
  assert.equal(sharedPackage.ios_oauth, true);
  assert.deepEqual(workflow.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
  assert.equal(workflow.ios_oauth, true);
});

test('manual full verification selects all check families and all E2E cohorts', () => {
  const selection = selectChecksForEvent('workflow_dispatch', null, () => {
    throw new Error('Manual full verification does not compare a diff');
  });

  assert.equal(
    CHECK_KEYS.every((key) => selection[key]),
    true,
  );
  assert.deepEqual(selection.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
  assert.equal(selection.ios_oauth, true);
});

test('main pushes select affected cohorts from before and after SHAs and fail safe', () => {
  let receivedArgs;
  const selected = selectChecksForEvent('push', { before: sha('a'), after: sha('b') }, (args) => {
    receivedArgs = args;
    return 'M\0apps/mobile/e2e/next-visit-questions.e2e.js\0';
  });
  const docsOnly = selectChecksForEvent(
    'push',
    { before: sha('a'), after: sha('b') },
    () => 'M\0docs/development.md\0',
  );
  const incomplete = selectChecksForEvent('push', { before: sha('a') });

  assert.deepEqual(receivedArgs, [sha('a'), sha('b')]);
  assert.deepEqual(selected.ios_test_cohorts, [
    'core-integration',
    'questions-review',
    'questions-conversation',
    'questions-summary',
    'provider',
  ]);
  assert.equal(selected.ios_tests, true);
  assert.deepEqual(docsOnly.ios_test_cohorts, []);
  assert.deepEqual(incomplete.ios_test_cohorts, IOS_TEST_COHORT_NAMES);
  assert.equal(incomplete.ios_oauth, true);
});

test('base-ref edits compare the updated merge base and preserve affected cohort mapping', () => {
  let receivedArgs;
  const selection = selectChecksForEvent(
    'pull_request',
    {
      action: 'edited',
      changes: { base: { ref: { from: 'main', to: 'release' } } },
      pull_request: { base: { sha: sha('a') }, head: { sha: sha('b') } },
    },
    (args) => {
      receivedArgs = args;
      return 'M\0apps/mobile/src/recording/recordingController.ts\0';
    },
  );

  assert.deepEqual(receivedArgs, [sha('a') + '...' + sha('b')]);
  assert.equal(selection.ios_test_cohorts.includes('speech'), true);
});

test('title-only edits reuse existing source results without selecting any checks', () => {
  const selection = selectChecksForEvent(
    'pull_request',
    {
      action: 'edited',
      changes: { title: { from: 'old title' } },
      pull_request: { base: { sha: sha('a') }, head: { sha: sha('b') } },
    },
    () => {
      throw new Error('Metadata-only edits do not compare source paths');
    },
  );

  assert.equal(selection.metadata_only_edit, true);
  assert.equal(
    CHECK_KEYS.some((key) => selection[key]),
    false,
  );
  assert.deepEqual(selection.ios_test_cohorts, []);
});

test('draft source changes stay explicitly selected while the full validation is deferred', () => {
  const selection = selectChecksForPaths(['apps/mobile/src/recording/recordingController.ts']);

  assert.equal(
    resolveFullValidationDeferred('pull_request', { pull_request: { draft: true } }),
    true,
  );
  assert.equal(selection.ios_test_cohorts.includes('recordings'), true);
});

test('unavailable path comparison fails safe to all checks and cohorts', () => {
  const selection = selectChecksForEvent(
    'pull_request',
    { pull_request: { base: { sha: sha('a') }, head: { sha: sha('b') } } },
    () => {
      throw new Error('Base object is unavailable');
    },
  );

  assert.equal(selection.all, true);
  assert.equal(selection.ios_test_cohorts.length, IOS_TEST_COHORT_NAMES.length);
  assert.equal(selection.ios_oauth, true);
});
