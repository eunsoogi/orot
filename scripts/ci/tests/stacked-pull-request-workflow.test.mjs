import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveChangedPaths, resolveFullValidationDeferred } from '../select-changed-paths.mjs';

function eventBlock(path, event) {
  const source = readFileSync(path, 'utf8');
  const match = source.match(
    new RegExp(`^  ${event}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|^[a-z_]+:|$(?![\\s\\S]))`, 'm'),
  );
  assert.ok(match, `Missing ${event} trigger in ${path}`);
  return match[1];
}

test('protected check workflows and stale-focus cancellation receive stacked PR events', () => {
  for (const path of [
    '.github/workflows/code-quality.yml',
    '.github/workflows/e2e-test.yml',
    '.github/workflows/unit-test.yml',
    '.github/workflows/policy-check.yml',
    '.github/workflows/cancel-stale-focused-native.yml',
  ]) {
    const event = eventBlock(path, 'pull_request');
    assert.doesNotMatch(event, /branches(?:-ignore)?:/);
    assert.match(event, /synchronize/);
    if (!path.includes('cancel-stale'))
      assert.match(eventBlock(path, 'push'), /branches: \[main\]/);
  }
});

test('stacked comparisons use the event base and exact head, and only drafts defer the full gate', () => {
  const pullRequest = {
    base: { ref: 'eunsoogi/parent-lane', sha: 'a'.repeat(40) },
    head: { sha: 'b'.repeat(40) },
    draft: true,
  };
  let received;
  const result = resolveChangedPaths('pull_request', { pull_request: pullRequest }, (args) => {
    received = args;
    return 'M\0apps/mobile/ios/OrotMobile/RecordingExportFiles.swift\0';
  });
  assert.deepEqual(received, ['a'.repeat(40) + '...' + 'b'.repeat(40)]);
  assert.equal(result.complete, true);
  assert.equal(resolveFullValidationDeferred('pull_request', { pull_request: pullRequest }), true);
  assert.equal(
    resolveFullValidationDeferred('pull_request', {
      pull_request: { ...pullRequest, draft: false },
    }),
    false,
  );
  assert.equal(resolveFullValidationDeferred('pull_request', { pull_request: {} }), false);
});
