import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function workflow() {
  const workflowPath = fileURLToPath(
    new URL('../../../.github/workflows/release.yml', import.meta.url),
  );
  const json = execFileSync(
    'ruby',
    ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV.fetch(0)))', workflowPath],
    { encoding: 'utf8' },
  );
  return JSON.parse(json);
}

test('dispatch accepts a version and dry-run/publish mode without caller-supplied evidence', () => {
  const config = workflow();
  const trigger = config.on ?? config.true;
  const inputs = trigger.workflow_dispatch.inputs;
  assert.deepEqual(inputs.mode.options, ['dry-run', 'publish']);
  assert.equal(inputs.mode.default, 'dry-run');
  assert.equal(inputs.version.required, true);
  for (const removed of ['source_sha', 'ci_run_id', 'readiness_evidence_json'])
    assert.equal(inputs[removed], undefined);
});

test('serializes every release dispatch and scopes write permission to the publish job', () => {
  const config = workflow();
  assert.equal(config.concurrency.group, 'orot-release-publication');
  assert.equal(config.concurrency['cancel-in-progress'], false);
  assert.deepEqual(config.permissions, { actions: 'read', contents: 'read' });
  assert.deepEqual(config.jobs.verify.permissions, { actions: 'read', contents: 'read' });
  assert.deepEqual(config.jobs.publish.permissions, { actions: 'read', contents: 'write' });
  assert.match(config.jobs.publish.if, /publication_allowed/);
});
