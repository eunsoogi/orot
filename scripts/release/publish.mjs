import { appendFileSync } from 'node:fs';
import { collectReleaseContext, ghApi, readRelease, readTagTarget } from './github.mjs';
import { validateCandidate } from './policy.mjs';
import { buildReleaseRequest } from './release-request.mjs';

function escapeMarkdown(value) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
}

try {
  const context = collectReleaseContext();
  const result = validateCandidate(context);
  if (context.mode !== 'publish' || !result.valid || !result.publicationAllowed) {
    throw new Error('publish preflight did not authorize publication');
  }

  let tagTarget = readTagTarget(context.tag);
  if (tagTarget && tagTarget !== context.sourceSha)
    throw new Error('refusing to move an existing release tag');
  if (!tagTarget) {
    try {
      ghApi('POST', `repos/eunsoogi/orot/git/refs`, {
        ref: `refs/tags/${context.tag}`,
        sha: context.sourceSha,
      });
    } catch {
      tagTarget = readTagTarget(context.tag);
      if (tagTarget !== context.sourceSha)
        throw new Error('tag creation raced with another target; no release was created');
    }
  }
  tagTarget = readTagTarget(context.tag);
  if (tagTarget !== context.sourceSha)
    throw new Error('release tag does not point to the verified source commit');
  if (readRelease('eunsoogi/orot', context.tag))
    throw new Error('release appeared during preflight; refusing to overwrite or duplicate it');

  const limitations = context.readiness.knownLimitations
    .map((item) => `- ${escapeMarkdown(item)}`)
    .join('\n');
  const notes = [
    `# Orot v${context.version}`,
    '',
    `Source commit: \`${context.sourceSha}\``,
    `Verified CI run: ${context.ciRun.html_url}`,
    '',
    '## Known limitations',
    limitations,
    '',
    '## Distribution',
    'This release contains no installable iPhone IPA. CI simulator builds and Detox results are simulator-only and are not distribution-signing evidence.',
    '',
  ].join('\n');
  const created = ghApi(
    'POST',
    'repos/eunsoogi/orot/releases',
    buildReleaseRequest({
      version: context.version,
      sourceSha: context.sourceSha,
      notes,
    }),
  );
  const readback = readRelease('eunsoogi/orot', context.tag);
  if (
    !readback ||
    readback.id !== created.id ||
    readback.tag_name !== context.tag ||
    readback.body !== notes ||
    (readback.assets ?? []).length !== 0
  ) {
    throw new Error('GitHub Release readback did not match the verified candidate');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## Release published\n\n- Release: ${readback.html_url}\n- Tag: \`${context.tag}\`\n- Source commit: \`${context.sourceSha}\`\n- Release assets: none\n`,
    );
  }
  console.log(
    `Published ${context.tag} at ${context.sourceSha}; GitHub Release contains no binary assets.`,
  );
} catch (error) {
  console.error(`Release publication failed closed: ${error.message}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\nRelease publication failed closed: ${error.message}\n`,
    );
  process.exitCode = 1;
}
