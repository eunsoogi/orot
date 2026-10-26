import { appendFileSync } from 'node:fs';
import { buildReleaseNotes } from './changelog.mjs';
import { collectReleaseContext } from './github.mjs';
import { readMainSha, readRelease, readTagTarget, writeGitHubJson } from './github-api.mjs';
import { validateCandidate } from './policy.mjs';
import { publishCandidate } from './publication.mjs';
import { buildReleaseRequest } from './release-request.mjs';

// This write-capable job recollects GitHub state so its checks are current at publication time.
try {
  const context = collectReleaseContext();
  const result = validateCandidate(context);
  if (context.mode !== 'publish' || !result.valid)
    throw new Error('publish mode requires a valid, current main candidate');

  const request = buildReleaseRequest({
    version: context.version,
    sourceSha: context.sourceSha,
    notes: buildReleaseNotes(context),
  });
  const outcome = publishCandidate({
    context,
    request,
    readMainSha: () => readMainSha('eunsoogi/orot'),
    readTagTarget: (tag) => readTagTarget('eunsoogi/orot', tag),
    readRelease: (tag) => readRelease('eunsoogi/orot', tag),
    createTag: (tag, sha) =>
      writeGitHubJson('POST', 'repos/eunsoogi/orot/git/refs', { ref: `refs/tags/${tag}`, sha }),
    createRelease: (body) => writeGitHubJson('POST', 'repos/eunsoogi/orot/releases', body),
  });

  const lines = [
    `## Release ${outcome.status === 'published' ? 'published' : 'already present'}`,
    '',
    `- Release: ${outcome.release.html_url ?? 'existing GitHub Release'}`,
    `- Tag: \`${context.tag}\``,
    `- Source commit: \`${context.sourceSha}\``,
    `- Added commit links: ${context.commits.length}`,
    '- No binary assets were uploaded.',
    '',
  ];
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  console.log(`${context.tag}: ${outcome.status}; no binary assets were uploaded.`);
} catch (error) {
  console.error(`Release publication failed closed: ${error.message}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\nRelease publication failed closed: ${error.message}\n`,
    );
  process.exitCode = 1;
}
