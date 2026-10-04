import { appendFileSync } from 'node:fs';
import { collectReleaseContext } from './github.mjs';
import { validateCandidate } from './policy.mjs';

function writeSummary(result, context) {
  const mode = context.mode === 'dry-run' ? 'Dry run' : 'Publish preflight';
  const outcome = result.publicationAllowed
    ? 'All publication gates passed'
    : 'Publication is blocked';
  const reasons = [...result.errors, ...result.blockers];
  const lines = [
    `## ${mode}: ${outcome}`,
    '',
    `- Version: \`${context.version}\``,
    `- Source commit: \`${context.sourceSha}\``,
    `- CI run: ${context.ciRun?.html_url ?? 'unavailable'}`,
    `- Tag: \`${context.tag}\` (${context.tagTargetSha ? 'already points at this commit' : 'not created'})`,
    '- No release or tag was created by this verification step.',
  ];
  if (reasons.length) lines.push('', 'Gate details:', ...reasons.map((reason) => `- ${reason}`));
  lines.push('');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

try {
  const context = collectReleaseContext();
  const result = validateCandidate(context);
  writeSummary(result, context);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `publication_allowed=${result.publicationAllowed}\n`);
  }
  if (!result.valid) throw new Error(result.errors.join('; '));
  if (result.blockers.length)
    console.log(`Dry run completed without publication: ${result.blockers.join('; ')}`);
  else
    console.log('Candidate verification passed; publication remains a separate explicit action.');
} catch (error) {
  console.error(`Release verification failed closed: ${error.message}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\nRelease verification failed closed: ${error.message}\n`,
    );
  process.exitCode = 1;
}
