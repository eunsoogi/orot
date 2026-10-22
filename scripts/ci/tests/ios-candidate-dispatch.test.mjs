import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIosCandidateDispatch } from '../ios-candidate-dispatch.mjs';

const context = {
  candidatePrNumber: '217',
  repository: 'eunsoogi/orot',
  eventName: 'workflow_dispatch',
  ref: 'refs/heads/eunsoogi/issue-216-validation-policy',
  sha: 'a'.repeat(40),
  apiUrl: 'https://api.github.com',
  token: 'test-token',
};
const pullRequest = {
  number: 217,
  state: 'open',
  draft: true,
  merged_at: null,
  base: { repo: { full_name: 'eunsoogi/orot' } },
  head: {
    repo: { full_name: 'eunsoogi/orot' },
    ref: 'eunsoogi/issue-216-validation-policy',
    sha: 'a'.repeat(40),
  },
};

function fetchPullRequest(value = pullRequest, status = 200) {
  return async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/eunsoogi/orot/pulls/217');
    assert.equal(options.headers.authorization, 'Bearer test-token');
    return { ok: status === 200, status, json: async () => value };
  };
}

test('accepts only the exact open same-repository Draft PR head selected for dispatch', async () => {
  assert.deepEqual(await validateIosCandidateDispatch(context, fetchPullRequest()), {
    pullRequestNumber: 217,
    headRef: 'eunsoogi/issue-216-validation-policy',
    headSha: 'a'.repeat(40),
  });
});

test('rejects missing or malformed PR numbers before making an API request', async () => {
  for (const candidatePrNumber of ['', undefined, '0', '01', '217abc', ' 217'])
    await assert.rejects(
      validateIosCandidateDispatch({ ...context, candidatePrNumber }, fetchPullRequest()),
      /positive decimal PR number/,
    );
});

test('rejects runs that are not dispatched from the candidate PR head branch and commit', async () => {
  for (const changed of [
    { eventName: 'pull_request' },
    { ref: 'refs/heads/main' },
    { ref: 'refs/pull/217/merge' },
    { sha: 'b'.repeat(40) },
  ])
    await assert.rejects(
      validateIosCandidateDispatch({ ...context, ...changed }, fetchPullRequest()),
      /workflow_dispatch|PR head branch|PR head commit/,
    );
});

test('rejects closed, ready, mismatched, forked, or merged PR candidates', async () => {
  const variants = [
    { ...pullRequest, state: 'closed' },
    { ...pullRequest, draft: false },
    { ...pullRequest, number: 216 },
    { ...pullRequest, head: { ...pullRequest.head, ref: 'other' } },
    { ...pullRequest, head: { ...pullRequest.head, sha: 'b'.repeat(40) } },
    {
      ...pullRequest,
      head: { ...pullRequest.head, repo: { full_name: 'contributor/orot' } },
    },
    {
      ...pullRequest,
      base: { repo: { full_name: 'other/orot' } },
    },
    { ...pullRequest, merged_at: '2026-10-22T00:00:00Z' },
  ];

  for (const candidate of variants)
    await assert.rejects(validateIosCandidateDispatch(context, fetchPullRequest(candidate)));
});

test('fails closed when the GitHub API cannot return a complete PR record', async () => {
  await assert.rejects(
    validateIosCandidateDispatch(context, fetchPullRequest(pullRequest, 404)),
    /HTTP 404/,
  );
  await assert.rejects(validateIosCandidateDispatch(context, fetchPullRequest({ number: 217 })));
});
