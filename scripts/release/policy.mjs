import { REQUIRED_CI_JOBS } from './ci-required-jobs.mjs';
import { compareVersions, isReleaseVersion } from './version-tags.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/i;

export { REQUIRED_CI_JOBS };

// A matching tag alone does not make a draft or prerelease a completed publication.
export function isPublishedReleaseForTag(release, tag) {
  return Boolean(
    release && release.tag_name === tag && release.draft === false && release.prerelease === false,
  );
}

// Require one passing instance of every protected context; duplicate or partial evidence fails closed.
export function validateCandidate(context) {
  const errors = [];

  if (!['dry-run', 'publish'].includes(context.mode))
    errors.push('mode must be dry-run or publish');
  if (!isReleaseVersion(context.version))
    errors.push('version must be MAJOR.MINOR.PATCH without a v prefix');
  if (context.applicationVersion !== context.version)
    errors.push('input version does not match the root and iOS application version');
  if (context.tag !== context.version)
    errors.push('release tag must exactly match the input version');
  if (context.ref !== 'refs/heads/main') errors.push('release workflow must run from main');
  if (
    !FULL_SHA.test(context.sourceSha ?? '') ||
    context.sha?.toLowerCase() !== context.sourceSha?.toLowerCase()
  )
    errors.push('source commit must be the full workflow candidate SHA');
  if (context.currentMainSha?.toLowerCase() !== context.sourceSha?.toLowerCase())
    errors.push('main advanced or no longer points to the workflow candidate');

  const run = context.ciRun;
  if (
    !run ||
    run.path !== '.github/workflows/e2e-test.yml' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.head_sha?.toLowerCase() !== context.sourceSha?.toLowerCase() ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  ) {
    errors.push('a successful main-push E2E Test run for this exact source commit is required');
  }

  for (const name of REQUIRED_CI_JOBS) {
    const matches = (context.ciJobs ?? []).filter((job) => job.name === name);
    if (
      matches.length !== 1 ||
      matches[0].status !== 'completed' ||
      matches[0].conclusion !== 'success'
    ) {
      errors.push(`required main-push check did not pass exactly once: ${name}`);
    }
  }

  if (context.previousTag) {
    if (!FULL_SHA.test(context.previousTag.sha ?? ''))
      errors.push('previous version tag has an invalid target SHA');
    if (!isReleaseVersion(context.previousTag.version))
      errors.push('previous version tag is invalid');
    else if (compareVersions(context.previousTag.version, context.version) >= 0)
      errors.push('previous version tag must be older than the input version');
  }

  if (
    context.tagTargetSha &&
    context.tagTargetSha.toLowerCase() !== context.sourceSha?.toLowerCase()
  )
    errors.push('existing release tag points to a different commit and will not be moved');
  if (
    context.release &&
    (!context.tagTargetSha || !isPublishedReleaseForTag(context.release, context.tag))
  )
    errors.push('an existing release is not published on the expected immutable tag');

  const valid = errors.length === 0;
  return {
    valid,
    publicationAllowed: valid,
    action: context.release ? 'already-published' : 'publish',
    errors,
  };
}
