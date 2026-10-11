import {
  ACCEPTED_CI_WORKFLOW_EVENTS,
  REQUIRED_CI_JOB_WORKFLOW_PATH,
  REQUIRED_CI_JOBS,
  TRUSTED_CI_WORKFLOW_PATHS,
} from './ci-required-jobs.mjs';
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

  // A manual full run may replace path-filtered pushes only for its exact trusted main workflow.
  const ciRuns = context.ciRuns ?? [];
  const trustedPaths = new Set(TRUSTED_CI_WORKFLOW_PATHS);
  const runByPath = new Map();
  for (const run of ciRuns) {
    if (!trustedPaths.has(run.path))
      errors.push(`main CI evidence contains an untrusted workflow path: ${run.path}`);
  }

  for (const path of TRUSTED_CI_WORKFLOW_PATHS) {
    const matches = ciRuns.filter((run) => run.path === path);
    if (matches.length !== 1) {
      errors.push(`trusted main validation workflow did not run exactly once: ${path}`);
      continue;
    }
    const [run] = matches;
    runByPath.set(path, run);
    if (
      !ACCEPTED_CI_WORKFLOW_EVENTS.includes(run.event) ||
      run.head_branch !== 'main' ||
      run.head_sha?.toLowerCase() !== context.sourceSha?.toLowerCase() ||
      run.status !== 'completed' ||
      run.conclusion !== 'success'
    ) {
      errors.push(
        `trusted main validation workflow did not complete successfully for the exact source commit: ${path}`,
      );
    }
  }

  for (const name of REQUIRED_CI_JOBS) {
    const matches = (context.ciJobs ?? []).filter((job) => job.name === name);
    const expectedPath = REQUIRED_CI_JOB_WORKFLOW_PATH[name];
    const expectedRun = runByPath.get(expectedPath);
    if (
      matches.length !== 1 ||
      matches[0].workflow_path !== expectedPath ||
      matches[0].workflow_run_id !== expectedRun?.id ||
      matches[0].status !== 'completed' ||
      matches[0].conclusion !== 'success'
    ) {
      errors.push(
        `required main check did not pass exactly once with its expected workflow path and selected run (${expectedPath}): ${name}`,
      );
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
