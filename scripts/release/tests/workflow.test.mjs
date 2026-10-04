import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('release workflow input describes the complete current evidence set after YAML parsing', () => {
  const workflowPath = fileURLToPath(
    new URL('../../../.github/workflows/release.yml', import.meta.url),
  );
  const description = execFileSync(
    'ruby',
    [
      '-ryaml',
      '-e',
      'workflow = YAML.load_file(ARGV.fetch(0)); trigger = workflow["on"] || workflow[true]; puts trigger.dig("workflow_dispatch", "inputs", "readiness_evidence_json", "description")',
      workflowPath,
    ],
    { encoding: 'utf8' },
  ).trim();

  for (const issue of ['#34', '#36', '#40', '#42']) assert.ok(description.includes(issue));
  assert.ok(description.includes('candidate approval'));
  assert.ok(description.includes('Never include credentials or health data'));
  assert.ok(!description.includes('#41'));
});
