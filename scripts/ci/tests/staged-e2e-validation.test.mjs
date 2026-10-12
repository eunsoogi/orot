import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { selectChecksForPaths } from '../changed-paths-select.mjs';
import { resolveFullValidationDeferred } from '../select-changed-paths.mjs';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

test('only an explicitly drafted pull request defers full E2E validation', () => {
  assert.equal(
    resolveFullValidationDeferred('pull_request', { pull_request: { draft: true } }),
    true,
  );
  for (const [event, payload] of [
    ['pull_request', { pull_request: { draft: false } }],
    ['pull_request', { pull_request: {} }],
    ['push', { pull_request: { draft: true } }],
    ['workflow_dispatch', { pull_request: { draft: true } }],
    ['pull_request', null],
  ]) {
    assert.equal(resolveFullValidationDeferred(event, payload), false, `${event} ${payload}`);
  }
});

test('draft mode does not weaken conservative changed-path selection', () => {
  const docs = selectChecksForPaths(['docs/development.md']);
  assert.equal(docs.policy_tests, true);
  assert.equal(docs.ios_build, false);
  assert.equal(docs.detox_release, false);

  const native = selectChecksForPaths(['apps/mobile/ios/OrotMobile/AppDelegate.swift']);
  assert.equal(native.detox_release, true);
  assert.equal(native.detox_openai, true);
  assert.equal(native.detox_transcription, true);
  assert.equal(native.detox_next_visit, true);
});

test('PR E2E workflow separates draft deferral from the full required gate', () => {
  const e2e = read('.github/workflows/e2e-test.yml');
  const required = ['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft'];
  const events = e2e
    .match(/types: \[([^\]]+)\]/)?.[1]
    ?.split(',')
    .map((event) => event.trim());
  for (const event of required) assert.ok(events?.includes(event), `missing PR event ${event}`);
  assert.match(
    e2e,
    /full_validation_deferred: \$\{\{ steps\.select\.outputs\.full_validation_deferred \}\}/,
  );
  assert.match(e2e, /Fail when full validation is deferred/);
  assert.match(
    e2e,
    /github\.event\.pull_request\.draft == true && 'ubuntu-latest' \|\| 'xcode-27'/,
  );
  assert.match(e2e, /pull_request\.draft == true && 'draft' \|\| 'full'/);
  assert.match(e2e, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);

  for (const path of [
    '.github/workflows/code-quality.yml',
    '.github/workflows/unit-test.yml',
    '.github/workflows/policy-check.yml',
  ]) {
    assert.match(read(path), /ready_for_review/);
  }
});

test('focused workflow validates the current PR head without replacing required checks', () => {
  const path = '.github/workflows/detox-e2e-focused.yml';
  assert.equal(existsSync(fileURLToPath(new URL(path, root))), true);
  const focus = read(path);
  assert.match(focus, /^name: Focused Detox scenario$/m);
  assert.match(focus, /pull-requests: read/);
  assert.match(focus, /head\.sha.*GITHUB_SHA|head\.sha.*EXPECTED_SHA/);
  assert.match(focus, /inputs\.scenario_file/);
  assert.match(focus, /inputs\.scenario_name/);
  assert.match(focus, /resource_sampling: true/);
  assert.match(focus, /inputs\.pr_number.*focused/);
  assert.match(focus, /cancel-in-progress: true/);
  assert.doesNotMatch(focus, /detox-e2e-profile-status\.yml/);
  assert.match(focus, /detox-e2e-profile-app-producer\.yml/);
  assert.match(focus, /detox-e2e-profile\.yml/);
});

test('draft deferral reaches stable profile checks without becoming an unknown runner input', () => {
  const calledWorkflows = (source, workflow) =>
    source
      .split(`uses: ./.github/workflows/${workflow}`)
      .slice(1)
      .map((call) => call.split(/\n {2}[A-Za-z][\w-]*:\n/, 1)[0]);
  for (const [path, expectedStatusCalls] of [
    ['.github/workflows/detox-e2e-profiles.yml', 3],
    ['.github/workflows/detox-e2e-release.yml', 2],
  ]) {
    const source = read(path);
    const statusCalls = calledWorkflows(source, 'detox-e2e-profile-status.yml');
    assert.equal(statusCalls.length, expectedStatusCalls);
    for (const call of statusCalls) {
      assert.match(call, /full_validation_deferred: \$\{\{ inputs\.full_validation_deferred \}\}/);
    }
    for (const call of calledWorkflows(source, 'detox-e2e-profile.yml')) {
      assert.doesNotMatch(call, /full_validation_deferred:/);
    }
  }
});
