import assert from 'node:assert/strict';
import test from 'node:test';
import { collectJobsForMainValidation, latestMainValidationRuns } from '../ci.mjs';
import { validateCandidate } from '../policy.mjs';
import { sourceSha, validContext } from './fixtures.mjs';

const fullPath = '.github/workflows/e2e-test.yml';
const selectedPath = '.github/workflows/e2e-selected.yml';

function diagnostic(conclusion) {
  return {
    id: 9999,
    path: selectedPath,
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: sourceSha,
    status: 'completed',
    conclusion,
    created_at: '2026-10-16T00:00:00Z',
  };
}

// Exercise the production release consumers, including newer diagnostics on the identical SHA.
for (const conclusion of ['success', 'failure', 'skipped', 'cancelled']) {
  test(`selected ${conclusion} cannot replace passing full evidence or satisfy a focused-only candidate`, () => {
    const context = validContext();
    const collect = (runs) =>
      collectJobsForMainValidation(sourceSha, runs, (id) => {
        assert.notEqual(id, 9999, 'Diagnostic jobs must never enter protected evidence');
        return context.ciJobs.filter((job) => job.workflow_run_id === id);
      });
    const combined = [...context.ciRuns, diagnostic(conclusion)];
    assert.equal(
      validateCandidate({
        ...context,
        ciRuns: latestMainValidationRuns(sourceSha, combined),
        ciJobs: collect(combined),
      }).valid,
      true,
    );
    const withoutFull = combined.filter((run) => run.path !== fullPath);
    const missing = validateCandidate({
      ...context,
      ciRuns: latestMainValidationRuns(sourceSha, withoutFull),
      ciJobs: collect(withoutFull),
    });
    assert.equal(missing.valid, false);
    assert.match(
      missing.errors.join('\n'),
      /trusted main validation workflow did not run exactly once: .*e2e-test.yml/,
    );
  });
}

test('release rejects a legacy full-path manual run even if it claims every required job passed', () => {
  const context = validContext();
  const manual = context.ciRuns.map((run) =>
    run.path === fullPath ? { ...run, event: 'workflow_dispatch' } : run,
  );
  assert.equal(validateCandidate({ ...context, ciRuns: manual }).valid, false);
  assert.equal(
    latestMainValidationRuns(sourceSha, manual).some((run) => run.path === fullPath),
    false,
  );
});
