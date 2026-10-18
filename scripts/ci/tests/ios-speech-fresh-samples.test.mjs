import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { cohortJobs, completionJob } from './fixtures/ios-workflow.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));

// Each complete CI execution uses one fresh Speech VM. Acceptance requires one complete execution, with no repeated Speech sample.
test('each full CI schedules every cohort once after verified products are available', () => {
  const full = workflow('e2e-test.yml');
  const cohorts = cohortJobs(full.jobs);
  assert.equal(cohorts.length, 15);
  assert.equal(iosTestExecutionPlan().filter((entry) => entry.cohort === 'speech').length, 1);
  for (const [, job] of cohorts) {
    assert.equal(job.inputs.sample, undefined);
    assert.ok(full.jobs.completeness.needs.includes(job.callerId));
  }
  const speech = cohorts.find(([, job]) => job.inputs.cohort === 'speech')[1];
  assert.deepEqual(speech.caller.needs, ['plan', 'release_products']);
  assert.equal(speech.leaf.if, "${{ contains(fromJSON(inputs.cohorts), 'speech') }}");
  assert.equal(speech.inputs.artifact_name, 'ios-test-release-products');
  assert.equal(
    speech.inputs.archive_digest,
    '${{ needs.release_products.outputs.archive_digest }}',
  );
  assert.equal(
    speech.inputs.manifest_digest,
    '${{ needs.release_products.outputs.manifest_digest }}',
  );
  assert.deepEqual(
    [...full.jobs.completeness.needs].sort(),
    [
      'debug_execution',
      'debug_products',
      'oauth_execution',
      'oauth_products',
      'plan',
      'production_validation',
      'release_products',
      'release_execution',
    ].sort(),
  );
});

test('raw and compact evidence is isolated by CI run and attempt without intra-run samples', () => {
  for (const name of ['ios-debug-tests.yml', 'ios-release-tests.yml'])
    assert.equal(workflow(name).on.workflow_call.inputs.sample, undefined);
  const action = yaml.load(readFileSync('.github/actions/ios-test-cohort-run/action.yml', 'utf8'));
  const execute = action.runs.steps.find(
    (step) => step.name === 'Execute every planned first attempt without compilation or retry',
  );
  assert.equal(execute.env.OROT_IOS_TEST_SAMPLE, undefined);
  const uploads = action.runs.steps.filter((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  );
  assert.equal(uploads.length, 2, 'Each cohort retains its raw and compact result artifacts');
  for (const step of uploads) {
    assert.equal(step.if, 'always()');
    assert.ok(step.with.name.endsWith('-${{ github.run_id }}-${{ github.run_attempt }}'));
    assert.ok(!step.with.name.includes('inputs.sample'));
  }
  const full = workflow('e2e-test.yml');
  const commands = completionJob(full.jobs)
    .steps.map((step) => step.run ?? '')
    .join('\n');
  assert.equal((commands.match(/ios-test-plan-results\.mjs /g) ?? []).length, 1);
  const aggregate = readFileSync('scripts/ci/ios-test-plan-results.mjs', 'utf8');
  assert.equal((aggregate.match(/speech-test-evidence\.mjs/g) ?? []).length, 1);
  assert.doesNotMatch(commands, /speech-second|speech-third/);
});

test('actual Linux plan reports separate producers, independent suites and the complete registered inventory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-speech-plan-'));
  try {
    const output = join(directory, 'outputs');
    const result = spawnSync(process.execPath, ['scripts/ci/ios-test-cohort-plan-cli.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        OROT_IOS_TEST_COHORTS: JSON.stringify([
          ...new Set(iosTestExecutionPlan().map((entry) => entry.cohort)),
        ]),
        OROT_IOS_OAUTH_TESTS: 'true',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.macJobs, 20);
    assert.equal(value.maximumConcurrentMacJobs, 17);
    assert.equal(value.uniqueTestCases, 94);
    assert.equal(value.scheduledTestObservations, 94);
    assert.equal(value.focusedSelectionObservations, undefined);
    assert.equal(value.totalScheduledTestObservations, undefined);
    assert.equal(value.speechSamples, undefined);
    const matrices = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const boundary = line.indexOf('=');
          return [line.slice(0, boundary), JSON.parse(line.slice(boundary + 1)).include];
        }),
    );
    assert.deepEqual(
      [...matrices.debug_matrix, ...matrices.release_matrix].sort((a, b) =>
        a.cohort.localeCompare(b.cohort),
      ),
      iosTestExecutionPlan().sort((a, b) => a.cohort.localeCompare(b.cohort)),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
