import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));

// Jobs on GitHub-hosted runners use fresh VMs. This graph proves sequencing and separate evidence, not observed integration passes.
test('three first Speech samples share verified products and stop after a failed prerequisite', () => {
  const full = workflow('ios-test-validation.yml');
  const ids = ['speech_execution', 'speech_sample_2', 'speech_sample_3'];
  const samples = ['first', 'second', 'third'];
  for (const [index, id] of ids.entries()) {
    const job = full.jobs[id];
    assert.ok(job, 'Missing fresh Speech sample: ' + id);
    assert.equal(job.uses, './.github/workflows/ios-test-cohort-execution.yml');
    assert.equal(job.with.cohort, 'speech');
    assert.equal(job.with.sample, samples[index]);
    assert.equal(job.with.artifact_name, 'ios-test-release-products');
    assert.equal(job.with.archive_digest, '${{ needs.release_execution.outputs.archive_digest }}');
    assert.equal(
      job.with.manifest_digest,
      '${{ needs.release_execution.outputs.manifest_digest }}',
    );
    if (index > 0) {
      assert.ok(job.needs.includes(ids[index - 1]));
      assert.equal(job.if, '${{ needs.' + ids[index - 1] + ".result == 'success' }}");
    }
    assert.ok(full.jobs.completeness.needs.includes(id));
  }
});

test('later samples retain separate raw and compact artifacts and enter Linux completeness', () => {
  const consumer = workflow('ios-test-cohort-execution.yml');
  assert.equal(consumer.on.workflow_call.inputs.sample?.default, 'first');
  const action = yaml.load(readFileSync('.github/actions/ios-test-cohort-run/action.yml', 'utf8'));
  const execute = action.runs.steps.find(
    (step) => step.name === 'Execute every planned first attempt without compilation or retry',
  );
  assert.equal(execute.env.OROT_IOS_TEST_SAMPLE, '${{ inputs.sample }}');
  const uploads = action.runs.steps.filter((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  );
  const speechUploads = uploads.filter((step) => !step.with.name.startsWith('ios-focused-'));
  assert.equal(speechUploads.length, 2, 'Speech retains its raw and compact result artifacts');
  for (const step of speechUploads) {
    assert.equal(step.if, 'always()');
    assert.ok(step.with.name.includes('inputs.sample'), step.name);
  }
  for (const step of uploads.filter((step) => step.with.name.startsWith('ios-focused-')))
    assert.equal(step.if, "always() && inputs.cohort != 'speech'");
  const full = workflow('ios-test-validation.yml');
  const commands = full.jobs.completeness.steps.map((step) => step.run ?? '').join('\n');
  for (const sample of ['second', 'third']) {
    assert.ok(
      commands.includes(
        `results.json artifacts/ios-reports/speech-${sample}-verified.json ${sample}`,
      ),
    );
    assert.ok(commands.includes(`speech-${sample}/speech-integration/attachments`));
  }
});

test('actual Linux plan reports five Mac jobs and the three fresh Speech samples', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-speech-plan-'));
  try {
    const output = join(directory, 'outputs');
    const result = spawnSync(process.execPath, ['scripts/ci/ios-test-cohort-plan-cli.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.macJobs, 5);
    assert.equal(value.maximumConcurrentMacJobs, 2);
    assert.equal(value.uniqueTestCases, 77);
    assert.equal(value.scheduledTestObservations, 100);
    assert.equal(value.focusedSelectionObservations, 2);
    assert.equal(value.totalScheduledTestObservations, 102);
    assert.deepEqual(value.speechSamples, ['first', 'second', 'third']);
    assert.match(readFileSync(output, 'utf8'), /speech_minutes=90/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
