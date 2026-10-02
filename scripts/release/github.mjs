import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEvidenceCommentUrl, parsePullRequestUrl } from './policy.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const VERSION = /^0\.1\.0$/;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? 'spawn error'})`);
  }
  return result.stdout.trim();
}

function ghJson(endpoint, allow404 = false) {
  const result = spawnSync('gh', ['api', endpoint], { encoding: 'utf8' });
  if (result.status !== 0) {
    if (allow404 && /\(HTTP 404\)/.test(result.stderr ?? '')) return null;
    throw new Error(`GitHub API read failed for ${endpoint}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}`);
  }
}

function getTagTarget(tag) {
  const result = spawnSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Unable to read the remote release tag');
  const lines = result.stdout.trim().split('\n').filter(Boolean).map((line) => line.split('\t'));
  const peeled = lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`)?.[0];
  const direct = lines.find(([, ref]) => ref === `refs/tags/${tag}`)?.[0];
  const target = peeled ?? direct ?? null;
  return target && FULL_SHA.test(target) ? target : null;
}

function parseReadiness(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('readiness evidence input is not valid JSON');
  }
}

function getEvidenceContext(repo, readiness) {
  const evidenceComments = {};
  const expectedIssues = { simulatorE2E: 42, evaluation: 41, deletion: 34, telemetry: 40 };
  for (const [name, issueNumber] of Object.entries(expectedIssues)) {
    const reference = readiness?.evidence?.[name];
    const ref = parseEvidenceCommentUrl(reference?.url, repo, issueNumber);
    if (!ref) continue;
    const comment = ghJson(`repos/${repo}/issues/comments/${ref.commentId}`);
    const issue = ghJson(`repos/${repo}/issues/${issueNumber}`);
    evidenceComments[name] = {
      id: comment.id,
      html_url: comment.html_url,
      issueNumber,
      body: comment.body,
      closed: issue.state === 'closed' && comment.issue_url === issue.url,
    };
  }

  const approvalRef = parsePullRequestUrl(readiness?.candidateApproval?.pullRequestUrl, repo);
  if (!approvalRef) return { evidenceComments, candidateApproval: null };
  const pull = ghJson(`repos/${repo}/pulls/${approvalRef.number}`);
  const reviewId = readiness?.candidateApproval?.reviewId;
  if (!Number.isSafeInteger(reviewId) || reviewId < 1) return { evidenceComments, candidateApproval: null };
  const review = ghJson(`repos/${repo}/pulls/${approvalRef.number}/reviews/${reviewId}`);
  return { evidenceComments, candidateApproval: { pull, review } };
}

export function collectReleaseContext(env = process.env) {
  const repo = env.GITHUB_REPOSITORY;
  if (repo !== 'eunsoogi/orot') throw new Error('release workflow is restricted to eunsoogi/orot');
  const version = env.OROT_VERSION ?? '';
  if (!VERSION.test(version)) throw new Error('release version must be 0.1.0');
  const tag = `v${version}`;
  const sourceSha = env.OROT_SOURCE_SHA ?? '';
  if (!FULL_SHA.test(sourceSha)) throw new Error('source_sha must be a full commit SHA');
  const ciRunId = env.OROT_CI_RUN_ID ?? '';
  if (!/^\d+$/.test(ciRunId)) throw new Error('ci_run_id must be numeric');

  const readiness = parseReadiness(env.OROT_READINESS_EVIDENCE_JSON);
  const ciRun = ghJson(`repos/${repo}/actions/runs/${ciRunId}`);
  const ciJobsResponse = ghJson(`repos/${repo}/actions/runs/${ciRunId}/jobs?per_page=100`);
  const ciJobs = Array.isArray(ciJobsResponse.jobs) ? ciJobsResponse.jobs : [];
  const release = ghJson(`repos/${repo}/releases/tags/${tag}`, true);
  const evidence = getEvidenceContext(repo, readiness);
  const mainContainsSource = spawnSync('git', ['merge-base', '--is-ancestor', sourceSha, 'origin/main']).status === 0;
  const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;

  return {
    mode: env.OROT_RELEASE_MODE,
    version,
    packageVersion,
    tag,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    sourceSha,
    ciRunId,
    ciRun,
    ciJobs,
    mainContainsSource,
    tagTargetSha: getTagTarget(tag),
    releaseExists: Boolean(release),
    readiness,
    ...evidence,
  };
}

export function ghApi(method, endpoint, fields = {}) {
  const args = ['api', '--method', method, endpoint];
  for (const [key, value] of Object.entries(fields)) {
    args.push(typeof value === 'boolean' ? '-F' : '-f', `${key}=${value}`);
  }
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`GitHub API ${method} failed for ${endpoint}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}`);
  }
}

export function readRelease(repo, tag) {
  return ghJson(`repos/${repo}/releases/tags/${tag}`, true);
}

export function readTagTarget(tag) {
  return getTagTarget(tag);
}
