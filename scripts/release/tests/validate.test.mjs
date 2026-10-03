import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidate } from '../policy.mjs';
import { buildReleaseRequest } from '../release-request.mjs';

const sourceSha = 'a'.repeat(40);
const ciRun = {
  id: 1234,
  path: '.github/workflows/ci.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: sourceSha,
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/eunsoogi/orot/actions/runs/1234',
};
const ciJobs = ['Quality', 'iOS Simulator Build', 'Detox iOS E2E']
  .map((name) => ({ name, status: 'completed', conclusion: 'success' }));
const evidenceNames = ['simulatorE2E', 'evaluation', 'deletion', 'telemetry'];
const evidenceIssues = { simulatorE2E: 42, evaluation: 36, deletion: 34, telemetry: 40 };
const evidenceComments = Object.fromEntries(evidenceNames.map((name) => {
  const issueNumber = evidenceIssues[name];
  const id = issueNumber * 100;
  return [name, {
    id,
    html_url: `https://github.com/eunsoogi/orot/issues/${issueNumber}#issuecomment-${id}`,
    issueNumber,
    closed: true,
    body: name === 'simulatorE2E'
      ? `Test fixture: iOS Simulator on iOS 27.0; scenarios: local retrieval and graph resume. Source commit ${sourceSha}. CI run: ${ciRun.html_url}. CI boundary: test-only fake provider/auth adapter. Actual provider OAuth configuration: fixture only; result: no live provider result claimed. Unverified hardware capabilities are recorded in known limitations.`
      : name === 'evaluation'
        ? `Test fixture: LangSmith evaluation of visit-question recommendations with synthetic consultation, HealthKit, Calendar and memory inputs. Source commit ${sourceSha}. Recorded source support, temporal and numeric correctness, question quality, clarification behavior, safety, latency and token usage. No real health data or production traces.`
        : `Test fixture: recorded outcome for ${name} on source commit ${sourceSha}.`,
  }];
}));
const approvalPull = {
  html_url: 'https://github.com/eunsoogi/orot/pull/99',
  merged: true,
  merge_commit_sha: sourceSha,
  base: { ref: 'main' },
  head: { sha: 'b'.repeat(40) },
  user: { login: 'author' },
};
const approvalReview = {
  id: 991,
  state: 'APPROVED',
  commit_id: approvalPull.head.sha,
  user: { login: 'reviewer' },
  submitted_at: '2026-10-02T00:00:00Z',
};
const readiness = {
  schemaVersion: 1,
  version: '0.1.0',
  sourceCommit: sourceSha,
  ciRunUrl: ciRun.html_url,
  evidence: Object.fromEntries(evidenceNames.map((name) => [name, { url: evidenceComments[name].html_url }])),
  knownLimitations: [
    'Physical-device behavior, including HealthKit, microphone and speech, remains unverified because 0.1.0 validation uses iOS Simulator only.',
    'CI produces no signed distribution artifact.',
  ],
  candidateApproval: {
    pullRequestUrl: approvalPull.html_url,
    reviewId: approvalReview.id,
    reviewerLogin: approvalReview.user.login,
    approvedAt: approvalReview.submitted_at,
  },
};

test('release creation sends false flags as JSON booleans', () => {
  const request = buildReleaseRequest({ version: '0.1.0', sourceSha, notes: 'release notes' });
  assert.equal(request.tag_name, 'v0.1.0');
  assert.equal(request.target_commitish, sourceSha);
  assert.equal(typeof request.draft, 'boolean');
  assert.equal(request.draft, false);
  assert.equal(typeof request.prerelease, 'boolean');
  assert.equal(request.prerelease, false);
});

function context(overrides = {}) {
  return {
    mode: 'publish',
    version: '0.1.0',
    packageVersion: '0.1.0',
    tag: 'v0.1.0',
    ref: 'refs/heads/main',
    sha: sourceSha,
    sourceSha,
    mainContainsSource: true,
    ciRunId: 1234,
    ciRun,
    ciJobs,
    tagTargetSha: null,
    releaseExists: false,
    readiness,
    evidenceComments,
    candidateApproval: { pull: approvalPull, review: approvalReview },
    ...overrides,
  };
}

test('accepts a complete candidate with the initial #36 LangSmith evaluation evidence', () => {
  assert.equal(evidenceComments.evaluation.issueNumber, 36);
  assert.match(readiness.evidence.evaluation.url, /\/issues\/36#issuecomment-/);
  const result = validateCandidate(context());
  assert.equal(result.valid, true);
  assert.equal(result.publicationAllowed, true);
  assert.deepEqual(result.errors, []);
});

test('rejects deferred comparative evaluation evidence from issue #41', () => {
  const oldCommentUrl = 'https://github.com/eunsoogi/orot/issues/41#issuecomment-4100';
  const oldComment = {
    ...evidenceComments.evaluation,
    id: 4100,
    html_url: oldCommentUrl,
    issueNumber: 41,
  };
  const result = validateCandidate(context({
    readiness: {
      ...readiness,
      evidence: { ...readiness.evidence, evaluation: { url: oldCommentUrl } },
    },
    evidenceComments: { ...evidenceComments, evaluation: oldComment },
  }));
  assert.equal(result.valid, false);
  assert.equal(result.publicationAllowed, false);
  assert.match(result.errors.join(' '), /required issue #36/);
});

test('dry run without readiness evidence completes as blocked and never authorizes publication', () => {
  const result = validateCandidate(context({ mode: 'dry-run', readiness: null }));
  assert.equal(result.valid, true);
  assert.equal(result.publicationAllowed, false);
  assert.match(result.blockers.join(' '), /readiness evidence is missing/);
});

test('publish fails closed when readiness evidence is missing or contains placeholders', () => {
  const missing = validateCandidate(context({ readiness: null }));
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join(' '), /readiness evidence/);

  const placeholder = structuredClone(readiness);
  placeholder.evidence.simulatorE2E.url = 'https://example.com/TODO';
  const stale = validateCandidate(context({ readiness: placeholder }));
  assert.equal(stale.valid, false);
  assert.equal(stale.publicationAllowed, false);
});

test('simulator evidence must cite the successful CI run and separate real auth from its fake CI boundary', () => {
  for (const body of [
    `iOS Simulator on iOS 27.0; scenarios: local retrieval. Source commit ${sourceSha}. CI uses a test-only fake provider adapter. Real provider OAuth configuration and result recorded.`,
    `iOS Simulator on iOS 27.0; scenarios: local retrieval. Source commit ${sourceSha}. CI run: ${ciRun.html_url}. Real provider OAuth configuration and result recorded.`,
    `iOS Simulator on iOS 27.0; scenarios: local retrieval. Source commit ${sourceSha}. CI run: ${ciRun.html_url}. CI boundary: test-only fake provider adapter.`,
  ]) {
    const comments = structuredClone(evidenceComments);
    comments.simulatorE2E.body = body;
    const result = validateCandidate(context({ evidenceComments: comments }));
    assert.equal(result.valid, false);
    assert.equal(result.publicationAllowed, false);
  }
});

test('release readiness names unverified physical-device capabilities even though no device run is required', () => {
  const incompleteLimitations = validateCandidate(context({ readiness: {
    ...readiness,
    knownLimitations: ['No signed distribution artifact is produced by CI.'],
  } }));
  assert.equal(incompleteLimitations.valid, false);
  assert.equal(incompleteLimitations.publicationAllowed, false);
  assert.match(incompleteLimitations.errors.join(' '), /unverified physical-device behavior/);
});

test('rejects a bad version and a source commit mismatch', () => {
  const badVersion = validateCandidate(context({ version: '0.1.1', tag: 'v0.1.1' }));
  assert.equal(badVersion.valid, false);
  assert.match(badVersion.errors.join(' '), /only version 0\.1\.0/);

  const badSource = validateCandidate(context({ sourceSha: 'c'.repeat(40) }));
  assert.equal(badSource.valid, false);
  assert.equal(badSource.publicationAllowed, false);
});

test('rejects failed, skipped, missing, or duplicate required CI jobs', () => {
  for (const jobs of [
    ciJobs.map((job, index) => index === 0 ? { ...job, conclusion: 'failure' } : job),
    ciJobs.map((job, index) => index === 1 ? { ...job, conclusion: 'skipped' } : job),
    ciJobs.map((job, index) => index === 2 ? { ...job, conclusion: 'failure' } : job),
    ciJobs.slice(1),
    [...ciJobs, ciJobs[0]],
  ]) {
    const result = validateCandidate(context({ ciJobs: jobs }));
    assert.equal(result.valid, false);
    assert.equal(result.publicationAllowed, false);
  }
});

test('refuses to move a tag or repeat an existing publication', () => {
  const movedTag = validateCandidate(context({ tagTargetSha: 'd'.repeat(40) }));
  assert.equal(movedTag.valid, false);
  assert.match(movedTag.errors.join(' '), /will not be moved/);

  const repeatedPublish = validateCandidate(context({ releaseExists: true }));
  assert.equal(repeatedPublish.valid, false);
  assert.match(repeatedPublish.errors.join(' '), /already exists/);
});

test('requires approval of the exact final candidate and current pull request head', () => {
  const staleApproval = validateCandidate(context({
    candidateApproval: { pull: approvalPull, review: { ...approvalReview, commit_id: 'e'.repeat(40) } },
  }));
  assert.equal(staleApproval.valid, false);
  assert.match(staleApproval.errors.join(' '), /non-author approval/);
});
