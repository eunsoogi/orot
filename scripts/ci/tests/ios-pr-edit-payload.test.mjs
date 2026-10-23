import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CHECK_KEYS } from '../changed-paths-core.mjs';
import { writeSelectionReport } from '../ios-e2e-selection-report.mjs';
import { selectChecksForEvent } from '../select-changed-paths.mjs';

const sha = (digit) => digit.repeat(40);
const allSelected = (selection) => CHECK_KEYS.every((key) => selection[key] === true);
const event = (changes) => ({
  action: 'edited',
  changes,
  pull_request: { base: { sha: sha('a') }, head: { sha: sha('b') } },
});

test('recognized title and body edits skip source checks', () => {
  const selection = selectChecksForEvent('pull_request', event({ title: { from: 'old' } }));

  assert.equal(selection.metadata_only_edit, true);
  assert.equal(
    CHECK_KEYS.some((key) => selection[key]),
    false,
  );
});

test('metadata-only PR edits keep their dedicated selection summary', () => {
  const previousCwd = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-metadata-only-pr-selection-'));
  const summaryPath = join(directory, 'summary.md');
  const originalEnvironment = new Map(
    ['GITHUB_ACTIONS', 'GITHUB_STEP_SUMMARY'].map((key) => [key, process.env[key]]),
  );
  const metadataEdit = event({ title: { from: 'Old title' } });
  try {
    process.chdir(directory);
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    const selection = selectChecksForEvent(
      'pull_request',
      metadataEdit,
      () => '',
      null,
      'refs/pull/217/merge',
    );

    assert.equal(selection.validation_tier, 'pr');
    assert.equal(selection.metadata_only_edit, true);
    writeSelectionReport(selection, 'pull_request', metadataEdit, false);

    const summary = readFileSync(summaryPath, 'utf8');
    assert.match(
      summary,
      /metadata-only edit; no new E2E run is scheduled for the unchanged source head/,
    );
    assert.doesNotMatch(summary, /scheduled for automatic execution/);
  } finally {
    process.chdir(previousCwd);
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('empty and unknown PR edit payloads fail safe to every check', () => {
  for (const changes of [{}, { reviewers: { from: [], to: ['reviewer'] } }]) {
    const selection = selectChecksForEvent('pull_request', event(changes));

    assert.equal(selection.reason, 'comparison-unavailable');
    assert.equal(allSelected(selection), true);
  }
});

test('base edits require both old and new refs before comparing the PR diff', () => {
  const incomplete = selectChecksForEvent(
    'pull_request',
    event({ base: { ref: { from: 'main' } } }),
    () => 'M\0docs/guide.md\0',
  );
  const complete = selectChecksForEvent(
    'pull_request',
    event({ base: { ref: { from: 'main', to: 'release' } } }),
    () => 'M\0docs/guide.md\0',
  );

  assert.equal(incomplete.reason, 'comparison-unavailable');
  assert.equal(allSelected(incomplete), true);
  assert.equal(complete.reason, 'matched-paths');
  assert.equal(complete.policy_tests, true);
});
