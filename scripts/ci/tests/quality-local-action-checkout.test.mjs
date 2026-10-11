import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readRepositoryFile = (path) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');
const codeQuality = readRepositoryFile('.github/workflows/code-quality.yml');
const qualitySetup = readRepositoryFile('.github/actions/setup-linux-quality/action.yml');

function jobBlock(jobId) {
  const start = codeQuality.indexOf(`  ${jobId}:\n`);
  if (start < 0) return '';
  const nextJob = /\n {2}[a-z0-9_-]+:\n/.exec(codeQuality.slice(start + 1));
  return codeQuality.slice(start, nextJob ? start + 1 + nextJob.index : undefined);
}

test('quality leaves check out the source before resolving local composite actions', () => {
  const jobs = [
    'lint_javascript',
    'lint_typescript',
    'lint_swift',
    'lint_objective_c',
    'lint_shell',
    'lint_ruby',
    'lint_yaml',
    'lint_json',
    'lint_xml',
    'lint_properties',
    'format_check',
  ];
  const checkoutAnchor = codeQuality.match(
    /- &quality_checkout[\s\S]*?uses: actions\/checkout@[a-f0-9]{40}[\s\S]*?persist-credentials: false/,
  );

  assert.ok(checkoutAnchor, 'the shared checkout step must disable credential persistence');

  for (const jobId of jobs) {
    const job = jobBlock(jobId);
    const checkout = job.search(/- (?:&quality_checkout|\*quality_checkout)/);
    const localAction = job.search(/uses: \.\/\.github\/actions\//);

    assert.ok(job, `missing ${jobId}`);
    assert.ok(localAction >= 0, `${jobId} must keep its local composite step`);
    assert.ok(
      checkout >= 0 && checkout < localAction,
      `${jobId} resolves its local action before checkout`,
    );
  }

  // The caller owns checkout because GitHub must load a local composite before its steps can run.
  assert.doesNotMatch(qualitySetup, /uses: actions\/checkout@/);
});
