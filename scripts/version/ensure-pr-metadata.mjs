import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
  assertVersionPrReadback,
  isPrMetadataCurrent,
  requiredPrMetadataFromIssue,
  versionPrDetails,
} from './metadata.mjs';

const repository = process.env.GITHUB_REPOSITORY ?? '';
const version = process.env.OROT_VERSION ?? '';
const pullRequestUrl = process.env.PULL_REQUEST_URL ?? '';

function ghJson(endpoint) {
  const result = spawnSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `GitHub API read failed for ${endpoint}: ${result.error?.message ?? result.stderr?.trim()}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}`);
  }
}

function applyIssueMetadata(number, milestone, assignees, labels) {
  const args = [
    'api',
    '--method',
    'PATCH',
    `repos/${repository}/issues/${number}`,
    '-F',
    `milestone=${milestone}`,
  ];
  for (const assignee of assignees) args.push('-f', `assignees[]=${assignee}`);
  for (const label of labels) args.push('-f', `labels[]=${label}`);

  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `GitHub could not update PR metadata: ${result.error?.message ?? result.stderr?.trim()}`,
    );
  }
}

function recordVerified() {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'metadata=verified\n');
}

function main() {
  if (repository !== 'eunsoogi/orot')
    throw new Error('version PR metadata is restricted to eunsoogi/orot');
  const url = new URL(pullRequestUrl);
  const match = /^\/eunsoogi\/orot\/pull\/(\d+)$/.exec(url.pathname);
  if (url.origin !== 'https://github.com' || !match)
    throw new Error('pull request URL is not a repository pull request');

  const details = versionPrDetails(version);
  const issue = ghJson(`repos/${repository}/issues/171`);
  const number = Number(match[1]);
  const pullRequest = ghJson(`repos/${repository}/pulls/${number}`);
  assertVersionPrReadback(pullRequest, details, repository, pullRequestUrl);
  const prIssue = ghJson(`repos/${repository}/issues/${number}`);
  const expected = requiredPrMetadataFromIssue(issue, prIssue);

  if (!isPrMetadataCurrent(prIssue, expected)) {
    applyIssueMetadata(number, expected.milestone, expected.assignees, expected.labels);
  }

  const updatedIssue = ghJson(`repos/${repository}/issues/${number}`);
  if (!isPrMetadataCurrent(updatedIssue, expected)) {
    throw new Error('version PR metadata readback is missing an issue field');
  }
  assertVersionPrReadback(
    ghJson(`repos/${repository}/pulls/${number}`),
    details,
    repository,
    pullRequestUrl,
  );
  recordVerified();
  console.log(`Verified metadata on ${pullRequest.html_url}.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
