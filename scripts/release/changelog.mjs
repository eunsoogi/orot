import { spawnSync } from 'node:child_process';
import { REQUIRED_CI_JOBS } from './ci-required-jobs.mjs';
import { isReleaseVersion } from './version-tags.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const MARKDOWN_SPECIALS = new Set([
  '\\',
  '`',
  '*',
  '_',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '#',
  '+',
  '-',
  '.',
  '!',
  '|',
  '>',
]);

export const KNOWN_LIMITATIONS = [
  'The required automation does not establish physical-device behavior or real provider/OAuth outcomes; those results remain unverified.',
  'This GitHub source release contains no signed or installable iOS binary. TestFlight and App Store distribution remain deferred to issue #174.',
];

export function parseCommitLog(output) {
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\0');
      const sha = separator < 0 ? '' : line.slice(0, separator);
      const subject = separator < 0 ? '' : line.slice(separator + 1);
      if (!FULL_SHA.test(sha)) throw new Error('Git returned a commit without a full SHA');
      return { sha: sha.toLowerCase(), subject: subject || '(empty commit message)' };
    });
}

// Without a prior reachable tag, use the repository history available in the full-depth checkout.
export function readCommitList(sourceSha, previousSha = null, run = spawnSync) {
  if (!FULL_SHA.test(sourceSha ?? '') || (previousSha && !FULL_SHA.test(previousSha)))
    throw new Error('release changelog requires full commit SHAs');
  const range = previousSha ? `${previousSha}..${sourceSha}` : sourceSha;
  const result = run('git', ['log', '--reverse', '--format=%H%x00%s', range], { encoding: 'utf8' });
  if (result.error || result.status !== 0)
    throw new Error('Git could not read commits for the release changelog');
  return parseCommitLog(result.stdout);
}

// Commit subjects are untrusted text and must not break their Markdown link labels.
function escapeMarkdown(value) {
  return [...String(value).replace(/[\r\n]+/g, ' ')]
    .map((character) => (MARKDOWN_SPECIALS.has(character) ? `\\${character}` : character))
    .join('');
}

export function buildReleaseNotes({ version, sourceSha, previousTag, commits }) {
  if (!isReleaseVersion(version) || !FULL_SHA.test(sourceSha ?? ''))
    throw new Error('release notes require a valid version and source commit');
  const title = previousTag ? `since ${previousTag.tag}` : 'from repository history';
  const commitLines = commits.length
    ? commits.map(({ sha, subject }) => {
        if (!FULL_SHA.test(sha ?? ''))
          throw new Error('release changelog contains an invalid commit SHA');
        return `- [${escapeMarkdown(subject)}](https://github.com/eunsoogi/orot/commit/${sha})`;
      })
    : ['- No commits were added in this version range.'];

  return [
    `# Orot ${version}`,
    '',
    `Source commit: \`${sourceSha}\``,
    '',
    `## Commits ${title}`,
    ...commitLines,
    '',
    '## Verification',
    `All ${REQUIRED_CI_JOBS.length} required main-branch checks passed for this exact source commit.`,
    '',
    '## Known limitations',
    ...KNOWN_LIMITATIONS.map((limitation) => `- ${limitation}`),
    '',
  ].join('\n');
}
