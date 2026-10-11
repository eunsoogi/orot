import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECK_KEYS } from '../changed-paths-core.mjs';
import {
  parseNameStatusOutput,
  resolveChangedPaths,
  selectChecksForEvent,
} from '../select-changed-paths.mjs';
import { selectChecksForPaths } from '../changed-paths-select.mjs';

const sha = (digit) => digit.repeat(40);
const allSelected = (selection) => CHECK_KEYS.every((key) => selection[key] === true);

test('manual dispatch always selects every protected check', () => {
  const selection = selectChecksForEvent('workflow_dispatch', null, () => {
    throw new Error('manual verification does not need a diff');
  });

  assert.equal(selection.reason, 'manual-full-verification');
  assert.equal(allSelected(selection), true);
});

test('pull requests compare their merge base with the head commit', () => {
  let receivedArgs;
  const comparison = resolveChangedPaths(
    'pull_request',
    { pull_request: { base: { sha: sha('a') }, head: { sha: sha('b') } } },
    (args) => {
      receivedArgs = args;
      return 'M\0docs/code-quality.md\0';
    },
  );
  const selection = selectChecksForPaths(comparison.paths);

  assert.deepEqual(receivedArgs, [sha('a') + '...' + sha('b')]);
  assert.equal(comparison.complete, true);
  assert.equal(selection.policy_tests, true);
  assert.equal(selection.ios_build, false);
  assert.equal(selection.detox_release, false);
});

test('main pushes compare the event before and after commits', () => {
  let receivedArgs;
  const comparison = resolveChangedPaths('push', { before: sha('a'), after: sha('b') }, (args) => {
    receivedArgs = args;
    return 'M\0apps/mobile/src/App.tsx\0';
  });
  const selection = selectChecksForPaths(comparison.paths);

  assert.deepEqual(receivedArgs, [sha('a'), sha('b')]);
  assert.equal(comparison.complete, true);
  assert.equal(selection.ios_build, true);
  assert.equal(selection.unit_tests, true);
  assert.equal(selection.detox_release, true);
});

test('deletions and both sides of renames remain in the changed path set', () => {
  const paths = parseNameStatusOutput(
    'D\0docs/removed.md\0R100\0docs/old.md\0apps/mobile/e2e/next-visit-questions.e2e.tsx\0',
  );
  const selection = selectChecksForPaths(paths);

  assert.deepEqual(paths, [
    'docs/removed.md',
    'docs/old.md',
    'apps/mobile/e2e/next-visit-questions.e2e.tsx',
  ]);
  assert.equal(selection.policy_tests, true);
  assert.equal(selection.typescript, true);
  assert.equal(selection.detox_next_visit, true);
  assert.equal(selection.detox_transcription, false);
  assert.equal(selection.ios_build, false);
});

test('docs and AGENTS changes keep policy checks while skipping app builds and E2E', () => {
  for (const path of ['AGENTS.md', 'docs/development.md']) {
    const selection = selectChecksForPaths([path]);
    assert.equal(selection.policy_tests, true, path);
    assert.equal(selection.ios_build, false, path);
    assert.equal(selection.detox_release, false, path);
    assert.equal(selection.unit_tests, false, path);
  }
});

test('non-app images are ignored while mobile bundle images validate native outputs', () => {
  const documentationImage = selectChecksForPaths(['docs/architecture.png']);
  const appImage = selectChecksForPaths(['apps/mobile/ios/OrotMobile/Images.xcassets/icon.png']);

  assert.equal(
    CHECK_KEYS.some((key) => documentationImage[key]),
    false,
  );
  assert.equal(appImage.ios_build, true);
  assert.equal(appImage.detox_release, true);
});

test('a dedicated E2E test file selects its profile and its language checks', () => {
  const selection = selectChecksForPaths(['apps/mobile/e2e/next-visit-questions.e2e.js']);

  assert.equal(selection.javascript, true);
  assert.equal(selection.source_loc, true);
  assert.equal(selection.detox_next_visit, true);
  assert.equal(selection.detox_release, false);
  assert.equal(selection.ios_build, false);
  assert.equal(selection.unit_tests, false);
});

test('reusable Detox workflow changes select policy, YAML, and every dependent E2E leaf', () => {
  const selection = selectChecksForPaths(['.github/workflows/detox-e2e-profile.yml']);

  assert.equal(selection.policy_tests, true);
  assert.equal(selection.yaml, true);
  assert.equal(selection.detox_release, true);
  assert.equal(selection.detox_openai, true);
  assert.equal(selection.detox_transcription, true);
  assert.equal(selection.detox_next_visit, true);
  assert.equal(selection.ios_build, false);
});

test('shared package resolution and CI tooling changes run every affected check', () => {
  for (const path of ['pnpm-lock.yaml', 'scripts/ci/run-test-suite.sh']) {
    const selection = selectChecksForPaths([path]);
    assert.equal(selection.all, true, path);
    assert.equal(allSelected(selection), true, path);
  }
});

test('an unknown path, incomplete comparison, or malformed rename fails safe to all checks', () => {
  for (const selection of [
    selectChecksForPaths(['new-tool/input.csv']),
    selectChecksForPaths(['docs/guide.md', null]),
    selectChecksForPaths(null),
  ]) {
    assert.equal(selection.all, true);
    assert.equal(allSelected(selection), true);
  }
  const firstPush = selectChecksForEvent('push', {
    before: '0000000000000000000000000000000000000000',
    after: sha('a'),
  });
  assert.equal(firstPush.reason, 'comparison-unavailable');
  assert.equal(allSelected(firstPush), true);

  const malformedRename = selectChecksForEvent(
    'pull_request',
    { pull_request: { base: { sha: sha('a') }, head: { sha: sha('b') } } },
    () => 'R100\0old/path.md\0',
  );
  assert.equal(malformedRename.reason, 'comparison-unavailable');
  assert.equal(allSelected(malformedRename), true);

  const unavailableDiff = selectChecksForEvent(
    'pull_request',
    { pull_request: { base: { sha: sha('a') }, head: { sha: sha('b') } } },
    () => {
      throw new Error('unavailable object');
    },
  );
  assert.equal(allSelected(unavailableDiff), true);
});

test('an unsupported event runs every check', () => {
  const selection = selectChecksForEvent('repository_dispatch', {});

  assert.equal(selection.reason, 'comparison-unavailable');
  assert.equal(allSelected(selection), true);
});

test('a valid empty comparison skips unrelated leaves', () => {
  const selection = selectChecksForEvent('push', { before: sha('a'), after: sha('b') }, () => '');

  assert.equal(selection.reason, 'no-changes');
  assert.equal(
    CHECK_KEYS.some((key) => selection[key]),
    false,
  );
});

test('the event resolver fails safe when a pull request comparison is incomplete', () => {
  const selection = selectChecksForEvent('pull_request', {
    pull_request: { base: { sha: sha('a') } },
  });

  assert.equal(selection.reason, 'comparison-unavailable');
  assert.equal(allSelected(selection), true);
});

test('the low-level resolver records a failed git comparison as incomplete', () => {
  const comparison = resolveChangedPaths(
    'pull_request',
    { pull_request: { base: { sha: sha('a') }, head: { sha: sha('b') } } },
    () => {
      throw new Error('unavailable object');
    },
  );

  assert.equal(comparison.complete, false);
});
