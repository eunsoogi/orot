import { spawnSync } from 'node:child_process';
import { classifyExistingVersionPr, versionPrDetails } from './metadata.mjs';

function gh(args, allowFailure = false) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN },
  });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new Error(
      `GitHub CLI failed: ${result.error?.message ?? result.stderr?.trim() ?? 'unknown error'}`,
    );
  }
  return result;
}

function githubJson(endpoint) {
  const result = gh(['api', endpoint], true);
  if (result.status !== 0) {
    throw new Error(
      `GitHub API read failed for ${endpoint}: ${result.stderr?.trim() ?? 'unknown error'}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}`);
  }
}

export function readRemoteVersionPrState(repository, branch) {
  const [owner] = repository.split('/');
  const query = new URLSearchParams({
    state: 'open',
    base: 'main',
    head: `${owner}:${branch}`,
    per_page: '100',
  });
  const pullRequests = githubJson(`repos/${repository}/pulls?${query}`);
  const ref = spawnSync('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], {
    encoding: 'utf8',
  });
  if (ref.error || ref.status !== 0)
    throw new Error(`Git could not read the remote branch ${branch}`);
  return { pullRequests, branchExists: Boolean(ref.stdout.trim()) };
}

export function createVersionPullRequest(repository, details, version) {
  // Generate body identity from the same validated input used by reuse and readback.
  const { body } = versionPrDetails(version);
  const result = gh(
    [
      'pr',
      'create',
      '--repo',
      repository,
      '--base',
      'main',
      '--head',
      details.branch,
      '--title',
      details.title,
      '--body',
      body,
      '--draft',
    ],
    true,
  );
  if (result.status === 0) return result.stdout.trim();

  // A concurrent dispatch may have created the same reviewable PR after the first lookup.
  const state = readRemoteVersionPrState(repository, details.branch);
  try {
    const classified = classifyExistingVersionPr({ ...state, repository, version });
    if (classified.action === 'reuse') return classified.url;
  } catch (error) {
    if (state.pullRequests.length > 0) throw error;
  }
  throw new Error(
    `GitHub could not create the PR. Check the Actions PR-creation setting and pull-requests:write permission. The branch remains ${details.branch}.`,
  );
}
