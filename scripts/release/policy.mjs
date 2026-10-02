export const REQUIRED_CI_JOBS = [
  'CI / Quality',
  'CI / iOS Simulator Build',
  'CI / Detox iOS E2E',
];

const EXPECTED_EVIDENCE = {
  simulatorE2E: 42,
  evaluation: 41,
  deletion: 34,
  telemetry: 40,
};
const PLACEHOLDER = /\b(?:tbd|todo|placeholder|example\.com|insert (?:link|url|evidence))\b/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;

export function parseEvidenceCommentUrl(value, repo, issueNumber) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const match = url.pathname.match(new RegExp(`^/${repo}/issues/${issueNumber}$`));
    const comment = url.hash.match(/^#issuecomment-(\d+)$/);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !match || !comment) return null;
    return { commentId: Number(comment[1]) };
  } catch {
    return null;
  }
}

export function parsePullRequestUrl(value, repo) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const match = url.pathname.match(new RegExp(`^/${repo}/pull/(\\d+)$`));
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !match) return null;
    return { number: Number(match[1]) };
  } catch {
    return null;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateReadiness(readiness, context, errors) {
  if (!isRecord(readiness)) {
    errors.push('release readiness evidence must be a JSON object');
    return;
  }
  if (readiness.schemaVersion !== 1) errors.push('readiness schemaVersion must be 1');
  if (readiness.version !== context.version) errors.push('readiness version does not match the candidate');
  if (readiness.sourceCommit !== context.sourceSha) errors.push('readiness sourceCommit does not match the candidate');
  if (readiness.ciRunUrl !== context.ciRun?.html_url) errors.push('readiness must link the verified CI run');

  if (!isRecord(readiness.evidence)) {
    errors.push('readiness evidence links are missing');
  } else {
    for (const [name, issueNumber] of Object.entries(EXPECTED_EVIDENCE)) {
      const reference = readiness.evidence[name];
      const actual = context.evidenceComments?.[name];
      if (!isRecord(reference) || typeof reference.url !== 'string' || !actual) {
        errors.push(`readiness evidence for issue #${issueNumber} is missing`);
        continue;
      }
      if (reference.url !== actual.html_url || !actual.html_url?.endsWith(`#issuecomment-${actual.id}`)) {
        errors.push(`readiness evidence for issue #${issueNumber} must link its actual comment`);
      }
      if (actual.issueNumber !== issueNumber || !actual.closed) {
        errors.push(`required issue #${issueNumber} is not closed with recorded evidence`);
      }
      if (typeof actual.body !== 'string') {
        errors.push(`evidence comment for issue #${issueNumber} is empty, stale, or a placeholder`);
        continue;
      }
      const body = actual.body.toLowerCase();
      if (!body.includes(context.sourceSha.toLowerCase()) || PLACEHOLDER.test(actual.body)) {
        errors.push(`evidence comment for issue #${issueNumber} is empty, stale, or a placeholder`);
      }
      if (name === 'simulatorE2E') {
        if (!body.includes('ios simulator')) {
          errors.push('simulator E2E evidence must identify iOS Simulator as its test platform');
        }
        if (!/\bios\s+\d+(?:\.\d+){0,2}\b/.test(body) || !/\bscenarios?\b/.test(body)) {
          errors.push('simulator E2E evidence must record the Simulator OS and exercised scenarios');
        }
        if (typeof context.ciRun?.html_url !== 'string' || !body.includes(context.ciRun.html_url.toLowerCase())) {
          errors.push('simulator E2E evidence must reference the actual CI run for this source commit');
        }
        if (!/\b(?:test[- ]only|fake|mock(?:ed)?)\b/.test(body) || !/\b(?:adapter|boundary)\b/.test(body)) {
          errors.push('simulator E2E evidence must identify its test-only fake external-provider boundary');
        }
        if (!/\b(?:oauth|real provider|actual provider|chatgpt)\b/.test(body) || !/\bconfig(?:uration)?\b/.test(body) || !/\b(?:result|outcome|blocker|blocked|unavailable|passed|failed|verified)\b/.test(body)) {
          errors.push('simulator E2E evidence must record the real provider-auth result or blocker');
        }
      }
    }
  }

  if (!Array.isArray(readiness.knownLimitations) || readiness.knownLimitations.length < 1 || readiness.knownLimitations.some((item) => typeof item !== 'string' || !item.trim() || PLACEHOLDER.test(item))) {
    errors.push('readiness must list known limitations or explicitly state that none remain');
  } else {
    const limitationText = readiness.knownLimitations.join(' ').toLowerCase();
    for (const capability of ['physical-device', 'healthkit', 'microphone', 'speech']) {
      if (!limitationText.includes(capability)) {
        errors.push(`known limitations must explicitly identify unverified ${capability} behavior`);
      }
    }
    if (!/unverified|not verified|not tested|not validated/.test(limitationText)) {
      errors.push('known limitations must state that the listed device capabilities remain unverified');
    }
  }

  const approval = readiness.candidateApproval;
  const actual = context.candidateApproval;
  if (!isRecord(approval) || !actual) {
    errors.push('an actual candidate approval review is required');
    return;
  }
  if (approval.pullRequestUrl !== actual.pull.html_url || approval.reviewId !== actual.review.id) {
    errors.push('candidate approval must reference the actual merged pull request and review');
  }
  if (actual.pull.merged !== true || actual.pull.base?.ref !== 'main' || actual.pull.merge_commit_sha !== context.sourceSha) {
    errors.push('candidate approval pull request must merge this source commit into main');
  }
  if (actual.review.state !== 'APPROVED' || actual.review.commit_id !== actual.pull.head?.sha || actual.review.user?.login === actual.pull.user?.login) {
    errors.push('candidate approval must be a non-author approval of the final pull request head');
  }
  if (approval.reviewerLogin !== actual.review.user?.login || approval.approvedAt !== actual.review.submitted_at) {
    errors.push('candidate approval reviewer and timestamp do not match GitHub review data');
  }
}

export function validateCandidate(context) {
  const errors = [];
  const blockers = [];
  const mode = context.mode;

  if (!['dry-run', 'publish'].includes(mode)) errors.push('mode must be dry-run or publish');
  if (context.version !== '0.1.0') errors.push('only version 0.1.0 is admitted by this workflow');
  if (context.packageVersion !== context.version) errors.push('package version does not match the requested release version');
  if (context.tag !== `v${context.version}`) errors.push('tag does not match the requested release version');
  if (context.ref !== 'refs/heads/main') errors.push('release workflow must run from main');
  if (!FULL_SHA.test(context.sourceSha ?? '') || context.sourceSha !== context.sha) errors.push('source commit must be the full current workflow commit SHA');
  if (!context.mainContainsSource) errors.push('source commit is not present on main');

  const run = context.ciRun;
  if (!run || String(run.id) !== String(context.ciRunId) || run.path !== '.github/workflows/ci.yml' || run.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== context.sourceSha || run.status !== 'completed' || run.conclusion !== 'success') {
    errors.push('CI run must be a successful main push run for this exact source commit');
  }
  for (const name of REQUIRED_CI_JOBS) {
    const matches = (context.ciJobs ?? []).filter((job) => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
      errors.push(`required CI job did not pass exactly once: ${name}`);
    }
  }

  if (context.tagTargetSha && context.tagTargetSha !== context.sourceSha) {
    errors.push('existing release tag points to a different commit and will not be moved');
  }
  if (context.releaseExists) {
    if (mode === 'publish') errors.push('a GitHub Release for this tag already exists; refusing to overwrite or duplicate it');
    else blockers.push('a GitHub Release already exists for this tag');
  }

  if (!context.readiness) {
    if (mode === 'publish') errors.push('publish requires complete release readiness evidence');
    else blockers.push('release readiness evidence is missing; this dry run cannot authorize publication');
  } else {
    validateReadiness(context.readiness, context, errors);
  }

  const valid = errors.length === 0;
  const publicationAllowed = valid && blockers.length === 0 && Boolean(context.readiness);
  return { valid, publicationAllowed, errors, blockers };
}
