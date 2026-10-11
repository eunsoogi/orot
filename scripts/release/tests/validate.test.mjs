import assert from 'node:assert/strict';
import test from 'node:test';
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

test('requires a successful E2E main-push run and each required check exactly once', () => {
  const badRun = validateCandidate(
    validContext({ ciRun: { ...validContext().ciRun, conclusion: 'failure' } }),
  );
  assert.match(badRun.errors.join(' '), /successful main-push E2E Test/);

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
  assert.equal(REQUIRED_CI_JOBS.length, 22);
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
