import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { REQUIRED_CI_JOBS_BY_WORKFLOW } from '../../release/ci-required-jobs.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = (path) => yaml.load(readFileSync(path, 'utf8'));

function protectedLeaves(path, parents = [], inputs = {}) {
  return Object.values(workflow(path).jobs).flatMap((job) => {
    const name = (job.name ?? '').replace(/\$\{\{ inputs\.profile \}\}/g, inputs.profile ?? '');
    const names = [...parents, name];
    if (job.uses) return protectedLeaves(job.uses.replace(/^\.\//, ''), names, job.with ?? {});
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.equal(job.if, 'always()');
    assert.equal(job['continue-on-error'], undefined);
    // GitHub expands the single status job into five separately named checks.
    // Preserve exact-name comparison after that expansion, including duplicate detection.
    const checks = job.strategy?.matrix?.include?.map(({ check }) => check) ??
      job.strategy?.matrix?.check ?? [null];
    return checks.map((check) =>
      names.join(' / ').replace(/\$\{\{ matrix\.check \}\}/g, check ?? ''),
    );
  });
}

test('five Linux integration domain leaves retain the exact required context names', () => {
  const e2e = workflow('.github/workflows/e2e-test.yml');
  const required = e2e.jobs.required_statuses;
  const protectedNameExpression =
    /\$\{\{\s*needs\.selection\.outputs\.non_protected_contexts == 'true' && 'Deferred' \|\| 'Validate'\s*\}\}/;
  assert.match(required.name, protectedNameExpression);
  const readyName = required.name.replace(protectedNameExpression, 'Validate');
  const deferredName = required.name.replace(protectedNameExpression, 'Deferred');
  const actual = protectedLeaves(required.uses.replace(/^\.\//, ''), [readyName]);
  const expected = REQUIRED_CI_JOBS_BY_WORKFLOW['.github/workflows/e2e-test.yml'];
  assert.deepEqual(actual.sort(), expected.filter((name) => name !== 'Validate / Build').sort());
  assert.equal(deferredName, 'Deferred');
  const buildNameExpression =
    /\$\{\{\s*needs\.selection\.outputs\.non_protected_contexts == 'true' && 'Deferred \/ Build' \|\| 'Validate \/ Build'\s*\}\}/;
  assert.match(e2e.jobs.ios_simulator_build.name, buildNameExpression);
  assert.equal(
    e2e.jobs.ios_simulator_build.name.replace(buildNameExpression, 'Validate / Build'),
    'Validate / Build',
  );
  assert.equal(
    e2e.jobs.ios_simulator_build.name.replace(buildNameExpression, 'Deferred / Build'),
    'Deferred / Build',
  );
  assert.equal(e2e.jobs.ios_simulator_build['runs-on'], 'ubuntu-24.04');
  assert.equal(e2e.jobs.plan.needs, 'selection');
  assert.equal(e2e.jobs.completeness.uses, './.github/workflows/ios-test-completeness.yml');
  assert.equal(e2e.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(e2e.jobs.selection.steps[0].with['fetch-depth'], 0);
});

test('full and focused visible job names use one consistent role and target', () => {
  const root = workflow('.github/workflows/e2e-test.yml');
  assert.equal(root.name, 'E2E Test');
  assert.equal(
    root.jobs.ios_validation,
    undefined,
    'The redundant Full display wrapper must be absent',
  );
  const entry = root.jobs;
  const full = Object.fromEntries(
    Object.entries(entry).filter(([id]) =>
      [...entry.completeness.needs, 'completeness'].includes(id),
    ),
  );
  const names = [];
  for (const job of Object.values(full)) {
    if (!job.uses) {
      names.push(job.name);
      continue;
    }
    const leaves = Object.values(workflow(job.uses.replace(/^\.\//, '')).jobs);
    // A matrix caller adds raw parameter suffixes in GitHub. Each feature therefore has one explicit call.
    assert.equal(job.strategy, undefined);
    for (const leaf of leaves) {
      const name = leaf.name.replace('${{ inputs.name }}', job.with?.name);
      names.push([job.name, name].join(' / '));
    }
  }
  const expected = [
    'Plan / Coverage',
    'Validate / Complete',
    ...['Debug', 'Release', 'Production', 'OAuth'].map((name) => 'Build / ' + name),
    ...iosTestExecutionPlan().map((item) => 'Test / ' + item.name),
    'Test / OAuth',
  ];
  assert.deepEqual(names.sort(), expected.sort());
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    const visible = root.name + ' / ' + name;
    assert.equal(visible.match(/E2E/g)?.length, 1);
    assert.doesNotMatch(name, /\$\{\{|[()\d]/);
  }
  const selected = workflow('.github/workflows/e2e-selected.yml').jobs.selected;
  const focused = workflow(selected.uses.replace(/^\.\//, '')).jobs;
  assert.deepEqual(
    Object.values(focused)
      .map((job) => selected.name + ' / ' + job.name)
      .sort(),
    [
      'iOS / Plan / Select',
      'iOS / Build / ${{ needs.selection.outputs.configuration }}',
      'iOS / Test / Selection',
      'iOS / Validate / Complete',
    ].sort(),
  );
});

test('full integration execution preserves all 87 scheduled observations and eight strict provider cases without a receipt substitution', () => {
  const scheduled = ['release', 'speech', 'debug'].flatMap((cohort) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );
  assert.equal(scheduled.length, 87);
  const identifiers = new Set(scheduled);
  assert.equal(identifiers.size, 87);
  const provider = iosTestInventory('provider-data');
  assert.equal(provider.length, 8);
  for (const identifier of provider) assert.ok(identifiers.has(identifier));
  const workflowSource = readFileSync('.github/workflows/e2e-test.yml', 'utf8');
  assert.doesNotMatch(
    workflowSource,
    /supported-provider-receipt|availability.*skip|continue-on-error/,
  );
  const mapping = readFileSync('docs/ios-validation.md', 'utf8');
  const [replacements, classification] = mapping.split(
    '## Requirement classification, reset and cost',
  );
  const expectedRequirements = Array.from(
    { length: 55 },
    (_, index) => `N${String(index + 1).padStart(3, '0')}`,
  );
  // Each table must cover all original requirements once; a duplicated row cannot hide a missing requirement.
  for (const table of [replacements, classification]) {
    const requirements = [...table.matchAll(/^\| (N\d{3}) \|/gm)].map((match) => match[1]);
    assert.deepEqual(requirements, expectedRequirements);
  }
});
