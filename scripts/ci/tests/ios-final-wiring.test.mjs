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
    return (job.strategy?.matrix?.check ?? [null]).map((check) =>
      names.join(' / ').replace(/\$\{\{ matrix\.check \}\}/g, check ?? ''),
    );
  });
}

test('five Linux integration domain leaves retain the exact required context names', () => {
  const e2e = workflow('.github/workflows/e2e-test.yml');
  const required = e2e.jobs.required_statuses;
  const actual = protectedLeaves(required.uses.replace(/^\.\//, ''), [required.name]);
  const expected = REQUIRED_CI_JOBS_BY_WORKFLOW['.github/workflows/e2e-test.yml'];
  assert.deepEqual(
    actual.sort(),
    expected.filter((name) => name !== 'E2E / Validate / Build').sort(),
  );
  assert.equal(e2e.jobs.ios_simulator_build.name, 'E2E / Validate / Build');
  assert.equal(e2e.jobs.ios_simulator_build['runs-on'], 'ubuntu-24.04');
  assert.equal(e2e.jobs.ios_validation.uses, './.github/workflows/ios-test-validation.yml');
  assert.equal(e2e.jobs.ios_validation.with, undefined);
  assert.equal(e2e.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(e2e.jobs.selection.steps[0].with['fetch-depth'], 0);
});

test('full and focused visible job names use one consistent role and target', () => {
  const entry = workflow('.github/workflows/e2e-test.yml').jobs;
  const full = workflow(entry.ios_validation.uses.replace(/^\.\//, '')).jobs;
  const names = [];
  for (const [id, job] of Object.entries(full)) {
    if (!job.uses) {
      names.push(entry.ios_validation.name + ' / ' + job.name);
      continue;
    }
    const leaves = Object.values(workflow(job.uses.replace(/^\.\//, '')).jobs);
    const targets =
      id.endsWith('_execution') && id !== 'oauth_execution'
        ? iosTestExecutionPlan().filter(
            (item) => item.configuration.toLowerCase() === id.split('_')[0],
          )
        : [job.with ?? {}];
    for (const target of targets)
      for (const leaf of leaves) {
        const name = leaf.name.replace('${{ inputs.name }}', target.name);
        names.push([entry.ios_validation.name, job.name, name].join(' / '));
      }
  }
  const expected = [
    'Plan / Coverage',
    'Validate / Complete',
    ...['Debug', 'Release', 'Production', 'OAuth'].map((name) => 'Build / ' + name),
    ...[...iosTestExecutionPlan().map((item) => item.name), 'OAuth'].map(
      (name) => 'Test / ' + name,
    ),
  ].map((name) => 'E2E / ' + name);
  assert.deepEqual(names.sort(), expected.sort());
  assert.equal(new Set(names).size, names.length);
  const focused = workflow(entry.focused_scenario.uses.replace(/^\.\//, '')).jobs;
  assert.deepEqual(
    Object.values(focused)
      .map((job) => entry.focused_scenario.name + ' / ' + job.name)
      .sort(),
    [
      'E2E / Focus / Plan / Select',
      'E2E / Focus / Build / ${{ needs.selection.outputs.configuration }}',
      'E2E / Focus / Test / Selection',
      'E2E / Focus / Validate / Complete',
    ].sort(),
  );
});

test('full integration execution preserves 82 scheduled observations and all eight strict provider cases without a receipt substitution', () => {
  const scheduled = ['release', 'speech', 'debug'].flatMap((cohort) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );
  assert.equal(scheduled.length, 82);
  const identifiers = new Set(scheduled);
  assert.equal(identifiers.size, 82);
  const provider = iosTestInventory('provider-data');
  assert.equal(provider.length, 8);
  for (const identifier of provider) assert.ok(identifiers.has(identifier));
  const workflowSource = readFileSync('.github/workflows/ios-test-validation.yml', 'utf8');
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
