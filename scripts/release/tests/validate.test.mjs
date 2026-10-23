import assert from 'node:assert/strict';
import test from 'node:test';
import { latestMainValidationRuns } from '../ci.mjs';
import { validateCandidate, REQUIRED_CI_JOBS } from '../policy.mjs';
import { buildReleaseRequest } from '../release-request.mjs';
import { sourceSha, validContext } from './fixtures.mjs';

test('accepts the exact stable application version and source tag', () => {
  const result = validateCandidate(validContext());
  assert.equal(result.valid, true);
  assert.equal(result.publicationAllowed, true);
  assert.equal(result.action, 'publish');
  assert.deepEqual(result.errors, []);
});

test('creates an exact-version tag without a v prefix', () => {
  const request = buildReleaseRequest({ version: '0.1.0', sourceSha, notes: 'release notes' });
  assert.equal(request.tag_name, '0.1.0');
  assert.equal(request.target_commitish, sourceSha);
  assert.equal(request.name, 'Orot 0.1.0');
  assert.equal(request.draft, false);
  assert.equal(request.prerelease, false);
});

test('rejects version strings outside the version-PR contract', () => {
  for (const version of ['v0.1.0', '0.1', '01.1.0', '0.1.0-rc.1', '0.1.0+build']) {
    const result = validateCandidate(
      validContext({ version, tag: version, applicationVersion: version }),
    );
    assert.equal(result.valid, false, version);
    assert.match(result.errors.join(' '), /MAJOR\.MINOR\.PATCH/);
  }
});

test('requires the root and iOS version sources, main, and candidate SHA to agree', () => {
  const mismatch = validateCandidate(validContext({ applicationVersion: '0.0.1' }));
  assert.match(mismatch.errors.join(' '), /application version/);

  const staleMain = validateCandidate(validContext({ currentMainSha: 'b'.repeat(40) }));
  assert.match(staleMain.errors.join(' '), /main advanced/);

  const wrongRef = validateCandidate(validContext({ ref: 'refs/heads/release' }));
  assert.match(wrongRef.errors.join(' '), /must run from main/);

  const sourceMismatch = validateCandidate(validContext({ sha: 'c'.repeat(40) }));
  assert.match(sourceMismatch.errors.join(' '), /workflow candidate SHA/);
});

test('accepts static-check pushes alongside the nightly full E2E schedule', () => {
  const context = validContext({
    ciRuns: validContext().ciRuns.map((run) => ({
      ...run,
      event: run.path === '.github/workflows/e2e-test.yml' ? 'schedule' : 'push',
    })),
  });
  const result = validateCandidate(context);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('requires the nightly E2E receipt for the exact release target after main advances', () => {
  const nextMainSha = 'b'.repeat(40);
  const previousRuns = validContext().ciRuns.map((run) => ({
    ...run,
    head_sha: run.path === '.github/workflows/e2e-test.yml' ? sourceSha : nextMainSha,
  }));
  const currentRuns = latestMainValidationRuns(nextMainSha, previousRuns);
  const context = validContext({
    sha: nextMainSha,
    sourceSha: nextMainSha,
    currentMainSha: nextMainSha,
    ciRuns: currentRuns,
  });
  const result = validateCandidate(context);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /scheduled main E2E receipt/);
  assert.match(result.errors.join(' '), /nightly run on this commit/);
});

test('requires exactly one successful trusted workflow run for the exact main commit', () => {
  const runs = validContext().ciRuns;
  const invalidRunSets = [
    runs.slice(1),
    [...runs, runs[0]],
    runs.map((run, index) => (index === 0 ? { ...run, status: 'in_progress' } : run)),
    runs.map((run, index) => (index === 0 ? { ...run, conclusion: 'failure' } : run)),
    runs.map((run, index) => (index === 0 ? { ...run, event: 'pull_request' } : run)),
    runs.map((run, index) => (index === 0 ? { ...run, head_branch: 'release' } : run)),
    runs.map((run, index) => (index === 0 ? { ...run, head_sha: 'b'.repeat(40) } : run)),
    runs.map((run, index) =>
      index === 0 ? { ...run, path: '.github/workflows/untrusted.yml' } : run,
    ),
  ];
  for (const ciRuns of invalidRunSets) {
    const result = validateCandidate(validContext({ ciRuns }));
    assert.equal(result.valid, false);
    assert.equal(result.publicationAllowed, false);
  }
});

test('rejects a required job attributed to the wrong trusted workflow path', () => {
  const ciJobs = validContext().ciJobs.map((job, index) =>
    index === 0 ? { ...job, workflow_path: '.github/workflows/unit-test.yml' } : job,
  );
  const result = validateCandidate(validContext({ ciJobs }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /expected workflow path/);
});

test('requires each job result to belong to its selected workflow run', () => {
  const ciJobs = validContext().ciJobs.map((job, index) =>
    index === 0 ? { ...job, workflow_run_id: 9999 } : job,
  );
  const result = validateCandidate(validContext({ ciJobs }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /expected workflow path and selected run/);
});

test('requires each required branch-protection job exactly once and completed successfully', () => {
  for (const jobs of [
    validContext().ciJobs.map((job, index) =>
      index === 0 ? { ...job, conclusion: 'failure' } : job,
    ),
    validContext().ciJobs.map((job, index) =>
      index === 1 ? { ...job, conclusion: 'skipped' } : job,
    ),
    validContext().ciJobs.slice(1),
    [...validContext().ciJobs, validContext().ciJobs[0]],
  ]) {
    const result = validateCandidate(validContext({ ciJobs: jobs }));
    assert.equal(result.valid, false);
    assert.equal(result.publicationAllowed, false);
  }
  assert.equal(REQUIRED_CI_JOBS.length, 16);
});

test('a newer failed dispatch run supersedes an older successful push run', () => {
  const goodRuns = validContext().ciRuns;
  const path = '.github/workflows/code-quality.yml';
  const previousPush = { ...goodRuns[0], id: 10, created_at: '2026-10-10T10:00:00Z' };
  const failedDispatch = {
    ...goodRuns[0],
    id: 11,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'failure',
    created_at: '2026-10-10T11:00:00Z',
  };
  const selected = latestMainValidationRuns(sourceSha, [
    ...goodRuns.slice(1),
    previousPush,
    failedDispatch,
  ]);
  assert.equal(selected.find((run) => run.path === path)?.id, 11);
  const result = validateCandidate(validContext({ ciRuns: selected }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /complete successfully/);
});

test('a newer queued run supersedes an older run that started later', () => {
  const goodRuns = validContext().ciRuns;
  const previousPush = {
    ...goodRuns[0],
    id: 10,
    created_at: '2026-10-10T10:00:00Z',
    run_started_at: '2026-10-10T10:30:00Z',
  };
  const queuedDispatch = {
    ...goodRuns[0],
    id: 11,
    event: 'workflow_dispatch',
    status: 'queued',
    conclusion: null,
    created_at: '2026-10-10T10:15:00Z',
    run_started_at: null,
  };
  const selected = latestMainValidationRuns(sourceSha, [
    ...goodRuns.slice(1),
    previousPush,
    queuedDispatch,
  ]);

  assert.equal(selected.find((run) => run.path === '.github/workflows/code-quality.yml')?.id, 11);

  const result = validateCandidate(validContext({ ciRuns: selected }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /did not complete successfully/);
});

test('refuses to move a version tag and rejects a release without its matching tag', () => {
  const movedTag = validateCandidate(validContext({ tagTargetSha: 'd'.repeat(40) }));
  assert.match(movedTag.errors.join(' '), /will not be moved/);

  const untaggedRelease = validateCandidate(
    validContext({ release: { tag_name: '0.1.0' }, tagTargetSha: null }),
  );
  assert.match(untaggedRelease.errors.join(' '), /expected immutable tag/);
});

test('treats an existing release on the exact immutable tag and source as an idempotent rerun', () => {
  const result = validateCandidate(
    validContext({
      tagTargetSha: sourceSha,
      release: {
        tag_name: '0.1.0',
        html_url: 'https://github.com/eunsoogi/orot/releases/tag/0.1.0',
        draft: false,
        prerelease: false,
      },
    }),
  );
  assert.equal(result.valid, true);
  assert.equal(result.action, 'already-published');
});

test('does not treat a draft or prerelease on the exact tag as a published release', () => {
  for (const release of [
    { tag_name: '0.1.0', draft: true, prerelease: false },
    { tag_name: '0.1.0', draft: false, prerelease: true },
  ]) {
    const result = validateCandidate(validContext({ tagTargetSha: sourceSha, release }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /not published/);
  }
});
