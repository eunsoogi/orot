import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverReadyValidationCandidate,
  verifyReusableReadyResults,
  verifyReusableReadySelection,
} from './ios-ready-validation-evidence-policy.mjs';

// Authenticated Actions adapter and receipt writer for metadata-only PR edits.
function reject(message) {
  throw new Error(message);
}

function currentEventFromEnvironment() {
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  return {
    repository: process.env.GITHUB_REPOSITORY,
    event: process.env.GITHUB_EVENT_NAME,
    action: payload.action,
    changes: payload.changes,
    metadataOnlyEdit: process.env.OROT_METADATA_ONLY_EDIT === 'true',
    selectionComplete: process.env.OROT_SELECTION_COMPLETE === 'true',
    pullRequest: {
      number: payload.pull_request?.number,
      draft: payload.pull_request?.draft,
      baseSha: payload.pull_request?.base?.sha,
      baseRef: payload.pull_request?.base?.ref,
      headSha: payload.pull_request?.head?.sha,
      headRef: payload.pull_request?.head?.ref,
    },
  };
}

async function apiPages(firstUrl, key, token, apiOrigin) {
  const values = [];
  let next = firstUrl;
  for (let page = 0; next && page < 5; page += 1) {
    const response = await fetch(next, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) reject(`GitHub Actions evidence lookup failed with HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data[key])) reject('GitHub Actions returned an incomplete evidence listing');
    values.push(...data[key]);
    const link = response.headers.get('link') ?? '';
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    next = match?.[1] ?? '';
    if (next && new URL(next).origin !== apiOrigin)
      reject('GitHub API pagination left its trusted host');
  }
  if (next) reject('GitHub Actions evidence listing exceeded the bounded pagination limit');
  return values;
}

function endpoint(base, path) {
  const prefix = base.pathname.replace(/\/$/, '');
  return new URL(prefix + path, base.origin);
}

async function discoverFromGitHub(current) {
  const token = process.env.GITHUB_TOKEN;
  const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  if (!token) reject('GitHub Actions token is unavailable for exact-head evidence lookup');
  const base = new URL(apiBase);
  const workflowUrl = endpoint(
    base,
    `/repos/${current.repository}/actions/workflows/e2e-test.yml/runs`,
  );
  workflowUrl.searchParams.set('head_sha', current.pullRequest.headSha);
  workflowUrl.searchParams.set('event', 'pull_request');
  workflowUrl.searchParams.set('per_page', '100');
  return discoverReadyValidationCandidate(
    {
      listRuns: () => apiPages(workflowUrl.toString(), 'workflow_runs', token, base.origin),
      listJobs: (run) => {
        if (!/^[1-9]\d*$/.test(String(run.id)))
          reject('GitHub returned an invalid workflow run identity');
        return apiPages(
          endpoint(
            base,
            `/repos/${current.repository}/actions/runs/${run.id}/jobs?per_page=100`,
          ).toString(),
          'jobs',
          token,
          base.origin,
        );
      },
      listArtifacts: (run) =>
        apiPages(
          endpoint(
            base,
            `/repos/${current.repository}/actions/runs/${run.id}/artifacts?per_page=100`,
          ).toString(),
          'artifacts',
          token,
          base.origin,
        ),
    },
    current,
  );
}

function writeOutput(values) {
  if (!process.env.GITHUB_OUTPUT) reject('GitHub Actions did not provide an output file');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
  );
}

function writeReceipt(receipt) {
  const path = 'artifacts/ios-e2e-reuse.json';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function inspectSelection(selectionPath, candidatePath, current) {
  const selection = readJson(selectionPath);
  const candidate = readJson(candidatePath);
  const verified = verifyReusableReadySelection(selection, candidate, current);
  writeReceipt({
    schemaVersion: 1,
    event: 'pull_request',
    action: 'edited',
    currentPullRequest: current.pullRequest,
    source: {
      runId: verified.sourceRunId,
      attempt: verified.sourceAttempt,
      url: candidate.run.html_url,
      mergeRefSha: selection.sourceSha,
    },
    selectedCohorts: verified.selectedCohorts,
    notSelectedCohorts: verified.notSelectedCohorts,
    executedCohorts: verified.selectedCohorts,
    notExecutedCohorts: [],
    oauthRequired: verified.oauthRequired,
    observationCount: null,
  });
  writeOutput({
    selected_cohorts: JSON.stringify(verified.selectedCohorts),
    oauth_required: verified.oauthRequired,
    has_selected_cohorts: verified.hasSelectedCohorts,
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const current = currentEventFromEnvironment();
  if (command === 'discover' && args.length === 1) {
    const candidate = await discoverFromGitHub(current);
    mkdirSync(dirname(args[0]), { recursive: true });
    writeFileSync(args[0], JSON.stringify(candidate, null, 2) + '\n');
    writeOutput({ source_run_id: candidate.run.id, source_attempt: candidate.run.run_attempt });
    return;
  }
  if (command === 'inspect-selection' && args.length === 2) {
    inspectSelection(args[0], args[1], current);
    return;
  }
  if (command === 'verify-results' && args.length === 3) {
    const selection = readJson(args[0]);
    const complete = readJson(args[1]);
    const candidate = readJson(args[2]);
    const verified = verifyReusableReadyResults(selection, complete, candidate, current);
    const receipt = readJson('artifacts/ios-e2e-reuse.json');
    if (
      receipt.source?.runId !== verified.sourceRunId ||
      receipt.source?.attempt !== verified.sourceAttempt
    )
      reject('Reuse receipt no longer matches the verified source run');
    receipt.observationCount = verified.observationCount;
    writeReceipt(receipt);
    return;
  }
  reject(
    'Usage: ios-ready-validation-evidence.mjs discover <candidate.json> | inspect-selection <selection.json> <candidate.json> | verify-results <selection.json> <complete.json> <candidate.json>',
  );
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]))
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
