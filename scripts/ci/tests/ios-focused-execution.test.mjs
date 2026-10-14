import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { selectFocusedIosTests } from '../ios-focused-selection.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const readYaml = (path) => yaml.load(readFileSync(path, 'utf8'));

// Synthetic child executables observe the shared dispatcher and exit propagation; no Apple command runs here.
function fixture(mode, identifier = 'Target/Suite/testSelected', status = 0) {
  const root = mkdtempSync(join(tmpdir(), 'orot-focused-execution-'));
  const bin = join(root, 'bin');
  const calls = join(root, 'calls.jsonl');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'node'),
    `#!${process.execPath}
const fs=require('node:fs'); const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args,suite:process.env.OROT_IOS_TEST_SUITE})+'\\n');
process.exit(${status});
`,
    { mode: 0o755 },
  );
  const products = join(root, 'verified products.xctestrun');
  const owner = join(root, 'owned destination.json');
  const output = join(root, 'selected evidence');
  const outcome = spawnSync(
    '/bin/bash',
    ['scripts/ci/run-ios-focused-tests.sh', 'fixtures', mode, identifier, products, owner, output],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: bin + ':' + process.env.PATH,
        OROT_IOS_TEST_SUITE: 'navigation',
      },
    },
  );
  return {
    products,
    owner,
    output,
    outcome,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('shared focus dispatch preserves exact case, empty fixture group and stateful phase arguments', () => {
  for (const [mode, identifier] of [
    ['plain', 'Target/Suite/testSelected'],
    ['fixture', 'Target/Suite/testSelected'],
    ['fixture', ''],
    ['backup', ''],
    ['local-model', ''],
  ]) {
    const value = fixture(mode, identifier);
    try {
      assert.equal(value.outcome.status, 0, value.outcome.stderr);
      const child = value.calls[0];
      assert.equal(child.suite, 'navigation');
      const suffix = mode === 'plain' ? 'results.xcresult' : mode === 'fixture' ? 'fixtures' : mode;
      const driver =
        mode === 'plain'
          ? 'run-ios-tests.mjs'
          : mode === 'fixture'
            ? 'run-ios-fixture-tests.mjs'
            : `run-ios-${mode}-tests.mjs`;
      const args = [
        'scripts/ci/' + driver,
        ...(['plain', 'fixture'].includes(mode) ? ['fixtures'] : []),
        value.products,
        value.owner,
        join(value.output, suffix),
        ...(identifier ? [identifier] : []),
      ];
      assert.deepEqual(child.args, args);
      assert.equal(value.calls.length, mode === 'plain' ? 2 : 1);
      if (mode === 'plain')
        assert.deepEqual(value.calls[1].args, [
          'scripts/ci/ios-test-results.mjs',
          'fixtures',
          join(value.output, suffix),
          join(value.output, 'results.json'),
          identifier,
        ]);
    } finally {
      value.dispose();
    }
  }
});

test('the first focused failure prevents verification and any retry or fallback', () => {
  for (const mode of ['plain', 'fixture', 'backup', 'local-model']) {
    const value = fixture(mode, mode === 'plain' ? 'Target/Suite/testSelected' : '', 65);
    try {
      assert.equal(value.outcome.status, 65);
      assert.equal(value.calls.length, 1);
    } finally {
      value.dispose();
    }
  }
  for (const [mode, identifier] of [
    ['unknown', ''],
    ['plain', ''],
  ]) {
    const value = fixture(mode, identifier);
    try {
      assert.notEqual(value.outcome.status, 0);
      assert.deepEqual(value.calls, []);
    } finally {
      value.dispose();
    }
  }
});

test('automatic focus follows full success, shares the exact dispatcher, and remains separate from full observations', () => {
  const action = readYaml('.github/actions/ios-test-cohort-run/action.yml').runs.steps;
  const selection = action.find((step) => step.id === 'focused');
  const execution = action.find((step) =>
    step.run?.includes('bash scripts/ci/run-ios-focused-tests.sh'),
  );
  const full = action.find((step) => step.run?.includes('run-ios-test-cohort.mjs'));
  const cleanup = action.find((step) => step.run?.includes('ios-test-simulator.mjs cleanup'));
  assert.ok(action.indexOf(full) < action.indexOf(selection));
  assert.ok(action.indexOf(selection) < action.indexOf(execution));
  assert.ok(action.indexOf(execution) < action.indexOf(cleanup));
  assert.equal(selection.if, "inputs.cohort != 'speech'");
  assert.equal(execution.if, "inputs.cohort != 'speech'");
  assert.equal(cleanup.if, 'always()');
  assert.match(execution.run, /cp "\$PRODUCT_DIRECTORY\/manifest.json"/);
  assert.doesNotMatch(execution.run, /prepare|build|boot|dispatch|retry/);
  const manual = readYaml('.github/workflows/ios-focused.yml').jobs.execution.steps;
  assert.equal(
    manual.filter((step) => step.run?.includes('bash scripts/ci/run-ios-focused-tests.sh')).length,
    1,
  );
  const reports = action.find((step) => step.with?.name?.startsWith('ios-focused-report-'));
  assert.match(reports.if, /always\(\)/);
  for (const file of [
    'focused/results.json',
    'focused/fixtures/results.json',
    'focused/product-artifact/manifest.json',
  ])
    assert.ok(reports.with.path.includes(file));
  const completeness = readYaml('.github/workflows/ios-test-validation.yml').jobs.completeness;
  assert.equal(completeness['runs-on'], 'ubuntu-24.04');
  const verification = completeness.steps.find((step) =>
    step.run?.includes('ios-focused-results.mjs'),
  );
  const selected = verification.run
    .trim()
    .split('\n')
    .map((line) => {
      const [, , profile, file, identifier] = line.trim().split(/\s+/);
      assert.ok(selection.env.PROFILE.includes(profile));
      assert.ok(selection.env.SOURCE_FILE.includes(file));
      assert.ok(selection.env.TEST_ID.includes(identifier));
      return selectFocusedIosTests(profile, file, identifier);
    });
  assert.deepEqual(
    selected.map((value) => [value.configuration, value.expectedCount, value.suite]),
    [
      ['Debug', 1, 'integration'],
      ['Release', 1, 'ui'],
    ],
  );
});
