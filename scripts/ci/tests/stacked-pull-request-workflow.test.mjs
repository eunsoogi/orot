import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveChangedPaths, resolveFullValidationDeferred } from '../select-changed-paths.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

function eventBlock(path, event) {
  const source = readFileSync(path, 'utf8');
  const inline = source.match(new RegExp(`^  ${event}: (\\{[^\\n]*\\})$`, 'm'));
  const match =
    inline ??
    source.match(
      new RegExp(`^  ${event}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|^[a-z_]+:|$(?![\\s\\S]))`, 'm'),
    );
  assert.ok(match, `Missing ${event} trigger in ${path}`);
  return match[1];
}

test('PR check workflows and stale-focus cancellation receive stacked PR events while E2E stays nightly', () => {
  for (const path of [
    '.github/workflows/code-quality.yml',
    '.github/workflows/unit-test.yml',
    '.github/workflows/policy-check.yml',
    '.github/workflows/cancel-stale-ios-focused.yml',
  ]) {
    const event = eventBlock(path, 'pull_request');
    assert.doesNotMatch(event, /branches(?:-ignore)?:/);
    assert.match(event, /synchronize/);
    if (!path.includes('cancel-stale'))
      assert.match(eventBlock(path, 'push'), /branches: \[main\]/);
  }
  const e2e = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  assert.deepEqual(Object.keys(e2e.on), ['schedule']);
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
