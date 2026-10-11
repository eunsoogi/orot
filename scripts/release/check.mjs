import { appendFileSync } from 'node:fs';
import {
  REQUIRED_CI_JOB_WORKFLOW_PATH,
  REQUIRED_CI_JOBS,
  TRUSTED_CI_WORKFLOW_PATHS,
} from './ci-required-jobs.mjs';
import { buildReleaseNotes } from './changelog.mjs';
import { collectReleaseContext } from './github.mjs';
import { validateCandidate } from './policy.mjs';

function passedCheckCount(context) {
  return REQUIRED_CI_JOBS.filter((name) => {
    const matches = (context.ciJobs ?? []).filter((job) => job.name === name);
    const expectedPath = REQUIRED_CI_JOB_WORKFLOW_PATH[name];
    const expectedRun = context.ciRuns?.find((run) => run.path === expectedPath);
    return (
      matches.length === 1 &&
      matches[0].workflow_path === expectedPath &&
      matches[0].workflow_run_id === expectedRun?.id &&
      matches[0].status === 'completed' &&
      matches[0].conclusion === 'success'
    );
  }).length;
}

function writeSummary(result, context) {
  const previous = context.previousTag
    ? `${context.previousTag.tag} (${context.previousTag.sha})`
    : 'none; first release includes repository history';
  const workflowRunLines = TRUSTED_CI_WORKFLOW_PATHS.map((path) => {
    const run = (context.ciRuns ?? []).find((candidate) => candidate.path === path);
    return run
      ? `- ${path}: ${run.event} run ${run.id}, ${run.status}/${run.conclusion}`
      : `- ${path}: missing`;
  });
  const lines = [
    `## Release ${result.valid ? 'candidate' : 'preflight failed'}`,
    '',
    `- Mode: \`${context.mode}\``,
    `- Input version and exact tag: \`${context.version}\``,
    `- Application version: \`${context.applicationVersion}\``,
    `- Workflow ref: \`${context.ref}\``,
    `- Candidate SHA: \`${context.sourceSha}\``,
    `- Current main SHA: \`${context.currentMainSha}\``,
    `- Previous reachable version tag: ${previous}`,
    `- Generated commit links: ${context.commits.length}`,
    `- Required main checks passed: ${passedCheckCount(context)}/${REQUIRED_CI_JOBS.length}`,
    `- Trusted main workflow runs selected: ${(context.ciRuns ?? []).length}/${TRUSTED_CI_WORKFLOW_PATHS.length}`,
    `- Existing tag: ${context.tagTargetSha ? `\`${context.tagTargetSha}\`` : 'none'}`,
    `- Existing GitHub Release: ${context.release ? context.release.html_url : 'none'}`,
  ];

  lines.push('', '### Main workflow run evidence', ...workflowRunLines);
  if (result.valid) lines.push('', '### Release body preview', '', buildReleaseNotes(context));
  if (result.errors.length)
    lines.push('', '### Blockers', ...result.errors.map((error) => `- ${error}`));
  lines.push('', 'The verification job does not create or modify tags or releases.', '');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

// The verify job reports publication readiness but never calls a write-capable GitHub endpoint.
try {
  const context = collectReleaseContext();
  const result = validateCandidate(context);
  writeSummary(result, context);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `publication_allowed=${result.publicationAllowed}\n`);
  if (!result.valid) throw new Error(result.errors.join('; '));
  if (context.mode === 'dry-run') console.log('Dry run passed; no tag or release was written.');
  else
    console.log(
      'Publish preflight passed; the write job will repeat the checks before publishing.',
    );
} catch (error) {
  console.error(`Release verification failed closed: ${error.message}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, 'publication_allowed=false\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\nRelease verification failed closed: ${error.message}\n`,
    );
  process.exitCode = 1;
}
