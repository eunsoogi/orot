import { replaceTopLevelJsonStringProperty } from './manifest-text.mjs';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MARKETING_VERSION_LINE = /^([\t ]*MARKETING_VERSION = )([^;\r\n]+);([\t ]*)$/gm;
// Version automation owns these classifications independently of any release issue.
const VERSION_PR_LABELS = ['area/foundation', 'type/ci', 'priority/p1'];
const VERSION_PR_ASSIGNEES = ['eunsoogi'];

function parseManifest(source, path) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new Error(`invalid JSON in ${path}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`expected a JSON object in ${path}`);
  }
  return manifest;
}

// Exact identity lines permit maintainer prose without accepting another version's summary.
function hasVersionBody(body, details) {
  if (typeof body !== 'string') return false;
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  return lines.includes(details.summary) && lines.includes(details.marker);
}

export function parseVersion(value) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new Error('version must use numeric major.minor.patch format without leading zeroes');
  }

  return value.split('.').map((part) => BigInt(part));
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }

  return 0;
}

export function assertMainDispatch({ eventName, ref }) {
  if (eventName !== 'workflow_dispatch') {
    throw new Error('version updates can only run from workflow_dispatch');
  }
  if (ref !== 'refs/heads/main') {
    throw new Error('version updates can only be dispatched from main');
  }
}

export function readAuthoritativeVersion({ rootManifest, projectFile }) {
  const rootVersion = rootManifest?.version;
  parseVersion(rootVersion);

  const marketingMatches = [...projectFile.matchAll(MARKETING_VERSION_LINE)];
  if (marketingMatches.length !== 2) {
    throw new Error(
      'version-source disagreement: expected exactly two iOS MARKETING_VERSION values',
    );
  }

  const marketingVersions = marketingMatches.map((match) => match[2].trim());
  if (marketingVersions.some((version) => version !== rootVersion)) {
    throw new Error(
      `version-source disagreement: root package is ${rootVersion}, iOS marketing values are ${marketingVersions.join(', ')}`,
    );
  }

  return rootVersion;
}

function renderManifest(source, version, path) {
  const manifest = parseManifest(source, path);
  if (typeof manifest.version !== 'string') {
    throw new Error(`version field is missing from ${path}`);
  }
  parseVersion(manifest.version);

  return replaceTopLevelJsonStringProperty(source, 'version', version, path);
}

export function planVersionUpdate({
  version,
  rootManifestSource,
  mobileManifestSource,
  workspaceManifests,
  projectFile,
}) {
  parseVersion(version);
  const rootManifest = parseManifest(rootManifestSource, 'package.json');
  const currentVersion = readAuthoritativeVersion({ rootManifest, projectFile });
  const comparison = compareVersions(version, currentVersion);

  if (comparison < 0) {
    throw new Error(`version ${version} is stale; current version is ${currentVersion}`);
  }
  if (comparison === 0) {
    return { status: 'current', currentVersion, version, updates: [] };
  }

  // Workspace package versions mirror the root release; dependency ranges and lockfiles stay intact.
  const updates = [
    { path: 'package.json', content: renderManifest(rootManifestSource, version, 'package.json') },
    {
      path: 'apps/mobile/package.json',
      content: renderManifest(mobileManifestSource, version, 'apps/mobile/package.json'),
    },
  ];

  for (const entry of [...workspaceManifests].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    updates.push({
      path: entry.path,
      content: renderManifest(entry.source, version, entry.path),
    });
  }

  const updatedProject = projectFile.replace(
    MARKETING_VERSION_LINE,
    (_match, prefix, _oldVersion, suffix) => `${prefix}${version};${suffix}`,
  );
  updates.push({
    path: 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
    content: updatedProject,
  });

  return { status: 'update', currentVersion, version, updates };
}

export function versionPrDetails(version) {
  parseVersion(version);
  const summary = `Updates Orot version metadata to ${version}.`;
  const marker = `<!-- orot-version-update:${version} -->`;
  return {
    branch: `automation/version-${version}`,
    title: `chore: update version to ${version}`,
    marker,
    summary,
    body: [
      summary,
      '',
      'The workflow changes only the root, mobile, workspace package, and iOS marketing version fields.',
      '',
      marker,
    ].join('\n'),
  };
}

export function requiredVersionPrMetadata(currentPrIssue) {
  // Preserve the observed labels and owners; milestone selection belongs only to maintainers.
  return {
    labels: [
      ...new Set([...currentPrIssue.labels.map((label) => label.name), ...VERSION_PR_LABELS]),
    ],
    assignees: [
      ...new Set([
        ...currentPrIssue.assignees.map((assignee) => assignee.login),
        ...VERSION_PR_ASSIGNEES,
      ]),
    ],
  };
}

export function isPrMetadataCurrent(prIssue, expected) {
  const labels = new Set(prIssue.labels.map((label) => label.name));
  const assignees = new Set(prIssue.assignees.map((assignee) => assignee.login));
  return (
    expected.labels.every((label) => labels.has(label)) &&
    expected.assignees.every((assignee) => assignees.has(assignee))
  );
}

export function assertVersionPrReadback(pullRequest, details, repository, url) {
  if (
    pullRequest.html_url !== url ||
    pullRequest.title !== details.title ||
    pullRequest.base?.ref !== 'main' ||
    pullRequest.head?.ref !== details.branch ||
    pullRequest.head?.repo?.full_name !== repository ||
    pullRequest.state !== 'open' ||
    pullRequest.draft !== true ||
    !hasVersionBody(pullRequest.body, details)
  ) {
    throw new Error(
      'version PR title, body, base, head, or draft state did not match the requested update',
    );
  }
}

export function classifyExistingVersionPr({ pullRequests, branchExists, repository, version }) {
  const expected = versionPrDetails(version);
  if (pullRequests.length > 1) {
    throw new Error(`multiple open pull requests use ${expected.branch}; refusing to choose one`);
  }

  if (pullRequests.length === 1) {
    const pullRequest = pullRequests[0];
    const matches =
      pullRequest.base?.ref === 'main' &&
      pullRequest.head?.ref === expected.branch &&
      pullRequest.head?.repo?.full_name === repository &&
      pullRequest.title === expected.title &&
      pullRequest.state === 'open' &&
      pullRequest.draft === true &&
      hasVersionBody(pullRequest.body, expected);

    if (!matches)
      throw new Error(
        `existing pull request for ${expected.branch} does not match this version update`,
      );
    return { action: 'reuse', url: pullRequest.html_url, branch: expected.branch };
  }

  if (branchExists) {
    throw new Error(
      `branch ${expected.branch} already exists without a matching open pull request; refusing to overwrite it`,
    );
  }

  return {
    action: 'create',
    branch: expected.branch,
    title: expected.title,
    marker: expected.marker,
  };
}
