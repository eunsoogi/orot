import { spawnSync } from 'node:child_process';
import { collectPaginatedItems } from './version-tags.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/i;

export function readGitHubJson(endpoint, allow404 = false) {
  const result = spawnSync('gh', ['api', endpoint], { encoding: 'utf8' });
  if (result.status !== 0) {
    if (allow404 && /\bHTTP 404\b/.test(result.stderr ?? '')) return null;
    throw new Error(`GitHub API read failed for ${endpoint}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}`);
  }
}

export function writeGitHubJson(method, endpoint, body) {
  const result = spawnSync('gh', ['api', '--method', method, endpoint, '--input', '-'], {
    encoding: 'utf8',
    input: JSON.stringify(body),
  });
  if (result.error || result.status !== 0)
    throw new Error(`GitHub API ${method} failed for ${endpoint}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}`);
  }
}

export function readMainSha(repo, readJson = readGitHubJson) {
  const ref = readJson(`repos/${repo}/git/ref/heads/main`);
  const sha = ref?.object?.sha;
  if (!FULL_SHA.test(sha ?? ''))
    throw new Error('GitHub did not return the current main commit SHA');
  return sha.toLowerCase();
}

// Peel annotated tags through GitHub's tag objects; release selection compares commit ancestry.
export function readTagTarget(repo, tag, readJson = readGitHubJson) {
  let target = readJson(`repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, true)?.object;
  if (!target) return null;

  const seen = new Set();
  for (let depth = 0; depth < 10; depth += 1) {
    if (target.type === 'commit' && FULL_SHA.test(target.sha ?? ''))
      return target.sha.toLowerCase();
    if (target.type !== 'tag' || !FULL_SHA.test(target.sha ?? '') || seen.has(target.sha))
      throw new Error(`GitHub returned an invalid tag target for ${tag}`);
    seen.add(target.sha);
    target = readJson(`repos/${repo}/git/tags/${target.sha}`)?.object;
    if (!target) throw new Error(`GitHub could not resolve annotated tag ${tag}`);
  }
  throw new Error(`annotated tag ${tag} exceeds the supported nesting depth`);
}

export function isCommitAncestor(repo, ancestorSha, candidateSha, readJson = readGitHubJson) {
  // GitHub reports an ancestor-to-descendant compare as ahead, and the same commit as identical.
  const result = readJson(`repos/${repo}/compare/${ancestorSha}...${candidateSha}`);
  return result.status === 'ahead' || result.status === 'identical';
}

export function listRepositoryTags(repo, readJson = readGitHubJson) {
  return collectPaginatedItems((page) => readJson(`repos/${repo}/tags?per_page=100&page=${page}`), {
    pageSize: 100,
    maxPages: 100,
  });
}

export function readRelease(repo, tag, readJson = readGitHubJson) {
  return readJson(`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, true);
}
