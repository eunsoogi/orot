import { appendFileSync } from 'node:fs';

const FULL_SHA = /^[a-f0-9]{40}$/i;
const POSITIVE_DECIMAL = /^[1-9]\d*$/;

function reject(message) {
  throw new Error(message);
}

function pullRequestEndpoint(apiUrl, repository, number) {
  let base;
  try {
    base = new URL(apiUrl);
  } catch {
    reject('Candidate validation requires a valid GitHub API URL');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    reject('Candidate validation requires a trusted HTTPS GitHub API URL');
  const prefix = base.pathname.replace(/\/$/, '');
  const [owner, name] = repository.split('/').map(encodeURIComponent);
  return new URL(`${prefix}/repos/${owner}/${name}/pulls/${number}`, base.origin).toString();
}

/** Bind a manual candidate run to one open same-repository Draft PR and its exact branch commit. */
export async function validateIosCandidateDispatch(context, fetchImpl = globalThis.fetch) {
  const numberText = context?.candidatePrNumber;
  if (typeof numberText !== 'string' || !POSITIVE_DECIMAL.test(numberText))
    reject('Candidate validation requires a positive decimal PR number');
  const number = Number(numberText);
  if (!Number.isSafeInteger(number)) reject('Candidate PR number exceeds the supported range');
  const repository = context?.repository;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ''))
    reject('Candidate validation requires a repository identity');
  if (context?.eventName !== 'workflow_dispatch')
    reject('Candidate validation is available only for workflow_dispatch');
  if (
    typeof context.ref !== 'string' ||
    !context.ref.startsWith('refs/heads/') ||
    context.ref === 'refs/heads/main'
  )
    reject('Candidate validation must run from a non-main PR head branch');
  if (!FULL_SHA.test(context.sha ?? ''))
    reject('Candidate validation requires the exact full PR head commit SHA');
  if (typeof context.token !== 'string' || !context.token)
    reject('Candidate validation requires the read-only GitHub token');
  if (typeof fetchImpl !== 'function') reject('Candidate validation requires GitHub API access');

  const url = pullRequestEndpoint(context.apiUrl ?? 'https://api.github.com', repository, number);
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${context.token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response?.ok)
    reject(`Candidate PR lookup failed with HTTP ${response?.status ?? 'unknown'}`);
  const pullRequest = await response.json();
  if (!pullRequest || typeof pullRequest !== 'object' || Array.isArray(pullRequest))
    reject('GitHub returned an incomplete candidate PR record');
  const headRef = context.ref.slice('refs/heads/'.length);
  if (
    pullRequest.number !== number ||
    pullRequest.state !== 'open' ||
    pullRequest.draft !== true ||
    pullRequest.merged_at != null ||
    pullRequest.base?.repo?.full_name !== repository ||
    pullRequest.head?.repo?.full_name !== repository
  )
    reject(
      'Candidate PR must be open, Draft, same-repository, and match the dispatched branch and head SHA',
    );
  if (pullRequest.head?.ref !== headRef)
    reject('Candidate PR head branch does not match the dispatched branch');
  if (
    typeof pullRequest.head?.sha !== 'string' ||
    pullRequest.head.sha.toLowerCase() !== context.sha.toLowerCase()
  )
    reject('Candidate PR head commit does not match the workflow SHA');
  return { pullRequestNumber: number, headRef, headSha: context.sha.toLowerCase() };
}

function writeCandidateOutputs(candidate, outputPath) {
  if (!outputPath) reject('GitHub Actions did not provide a candidate output file');
  appendFileSync(
    outputPath,
    [
      `candidate_pr_number=${candidate.pullRequestNumber}`,
      `candidate_head_ref=${candidate.headRef}`,
      `candidate_head_sha=${candidate.headSha}`,
    ].join('\n') + '\n',
  );
}

async function main(env = process.env) {
  const candidate = await validateIosCandidateDispatch({
    candidatePrNumber: env.OROT_CANDIDATE_PR_NUMBER,
    repository: env.GITHUB_REPOSITORY,
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    apiUrl: env.GITHUB_API_URL,
    token: env.GITHUB_TOKEN,
  });
  writeCandidateOutputs(candidate, env.GITHUB_OUTPUT);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `Candidate PR #${candidate.pullRequestNumber} is open and Draft at ${candidate.headRef}@${candidate.headSha}.\n`,
    );
  process.stdout.write(JSON.stringify(candidate) + '\n');
}

if (process.argv[1]?.endsWith('/ios-candidate-dispatch.mjs'))
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
