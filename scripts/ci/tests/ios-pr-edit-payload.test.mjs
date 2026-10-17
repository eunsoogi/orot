import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECK_KEYS } from '../changed-paths-core.mjs';
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
