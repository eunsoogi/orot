const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_TAG = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;

export function isReleaseVersion(value) {
  return typeof value === 'string' && RELEASE_VERSION.test(value);
}

function parts(value, expression = RELEASE_VERSION) {
  const match = typeof value === 'string' ? value.match(expression) : null;
  return match ? match.slice(1).map((part) => BigInt(part)) : null;
}

export function compareVersions(left, right) {
  const leftParts = parts(left);
  const rightParts = parts(right);
  if (!leftParts || !rightParts)
    throw new Error('version comparison requires MAJOR.MINOR.PATCH values');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index])
      return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function versionForTag(name) {
  const match = typeof name === 'string' ? name.match(VERSION_TAG) : null;
  return match ? match.slice(1).join('.') : null;
}

// Continue until a short page; a full page is not evidence that the tag list ended.
export function collectPaginatedItems(readPage, { pageSize = 100, maxPages = 100 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = readPage(page);
    if (!Array.isArray(result)) throw new Error('GitHub returned an invalid paginated list');
    items.push(...result);
    if (result.length < pageSize) return items;
  }
  throw new Error('GitHub pagination exceeded the supported page limit');
}

// Accept v-prefixed historical tags, but select only older versions reachable from this candidate.
export function selectPreviousVersionTag({ version, tags, resolveTag, isAncestor }) {
  if (!isReleaseVersion(version)) throw new Error('candidate version is invalid');
  const groups = new Map();
  for (const item of tags) {
    const name = typeof item === 'string' ? item : item?.name;
    const candidateVersion = versionForTag(name);
    if (!candidateVersion || compareVersions(candidateVersion, version) >= 0) continue;
    if (!groups.has(candidateVersion)) groups.set(candidateVersion, new Set());
    groups.get(candidateVersion).add(name);
  }

  const versions = [...groups.keys()].sort((left, right) => compareVersions(right, left));
  for (const candidateVersion of versions) {
    const names = [...groups.get(candidateVersion)].sort(
      (left, right) => Number(left.startsWith('v')) - Number(right.startsWith('v')),
    );
    const reachable = [];
    for (const name of names) {
      const sha = resolveTag(name);
      if (!sha) continue;
      if (!FULL_SHA.test(sha)) throw new Error(`tag ${name} did not resolve to a commit SHA`);
      if (isAncestor(sha)) reachable.push({ name, sha: sha.toLowerCase() });
    }

    const targets = new Set(reachable.map(({ sha }) => sha));
    if (targets.size > 1)
      throw new Error(`multiple reachable tags represent version ${candidateVersion}`);
    if (reachable.length)
      return { tag: reachable[0].name, sha: reachable[0].sha, version: candidateVersion };
  }
  return null;
}
