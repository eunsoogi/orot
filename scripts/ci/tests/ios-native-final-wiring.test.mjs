import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { REQUIRED_CI_JOBS_BY_WORKFLOW } from '../../release/ci-required-jobs.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

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
    return [names.join(' / ')];
  });
}

test('five Linux native compatibility leaves retain the exact protected context names', () => {
  const e2e = workflow('.github/workflows/e2e-test.yml');
  const required = e2e.jobs.required_statuses;
  const actual = protectedLeaves(required.uses.replace(/^\.\//, ''), [required.name]);
  const expected = REQUIRED_CI_JOBS_BY_WORKFLOW['.github/workflows/e2e-test.yml'];
  assert.deepEqual(actual.sort(), expected.filter((name) => name !== 'iOS Simulator Build').sort());
  assert.equal(e2e.jobs.ios_simulator_build.name, 'iOS Simulator Build');
  assert.equal(e2e.jobs.ios_simulator_build['runs-on'], 'ubuntu-24.04');
  assert.equal(e2e.jobs.native_validation.uses, './.github/workflows/ios-test-validation.yml');
  assert.equal(e2e.jobs.native_validation.with.production_build, true);
  assert.equal(e2e.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(e2e.jobs.selection.steps[0].with['fetch-depth'], 0);
});

test('full native execution preserves 77 methods and all eight strict provider cases without a receipt substitution', () => {
  const identifiers = new Set(
    ['release', 'speech', 'debug'].flatMap((cohort) =>
      iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
    ),
  );
  assert.equal(identifiers.size, 77);
  const provider = iosTestInventory('provider-data');
  assert.equal(provider.length, 8);
  for (const identifier of provider) assert.ok(identifiers.has(identifier));
  const workflowSource = readFileSync('.github/workflows/ios-test-validation.yml', 'utf8');
  assert.doesNotMatch(
    workflowSource,
    /supported-provider-receipt|availability.*skip|continue-on-error/,
  );
  const mapping = readFileSync('docs/native-validation.md', 'utf8');
  assert.equal((mapping.match(/^\| N\d{3} \|/gm) ?? []).length, 55);
});
