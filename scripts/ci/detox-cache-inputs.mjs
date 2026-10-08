import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Detox/Jest controls run in Node; Metro bundles ENTRY_FILE and imported app modules.
const HOST_ONLY_DETOX_INPUT =
  /^(?:apps\/mobile\/e2e\/.+\.(?:test|e2e)\.js|apps\/mobile\/(?:.+\/)?(?:.+\.)?jest\.config\.js|apps\/mobile\/e2e\/release-e2e-shards\.js|apps\/mobile\/e2e\/transcription\/transcriptEvidenceDetoxHelpers\.js|apps\/mobile\/src\/transcription\/__tests__\/TranscriptEvidenceDetoxHelpers\.spec\.js)$/;
const GENERATED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'pods',
  '.cache',
  'deriveddata',
  'coresimulator',
  'simulator',
  'keychains',
]);
// Git buffers paths before Node can apply the generated-tree filter, so mirror those exclusions here.
const GENERATED_PATHSPEC_ROOTS = ['apps/mobile', 'packages'];
const GENERATED_PATHSPEC_EXCLUSIONS = [
  ...GENERATED_PATHSPEC_ROOTS.flatMap((root) =>
    [...GENERATED_DIRECTORY_NAMES].map(
      (directoryName) =>
        `:(exclude,glob)${root}/**/${[...directoryName]
          .map((character) =>
            character >= 'a' && character <= 'z'
              ? `[${character}${character.toUpperCase()}]`
              : character,
          )
          .join('')}/**`,
    ),
  ),
  ':(exclude,glob)apps/mobile/ios/[bB][uU][iI][lL][dD]*/**',
];
// CocoaPods can rewrite these tracked files during installation, so the preinstall digest remains authoritative.
const PRIVACY_MANIFEST_INPUT = 'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy';
const COCOAPODS_PROJECT_INPUT = 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isGeneratedPath(path) {
  const segments = path.split('/');
  if (segments.some((segment) => GENERATED_DIRECTORY_NAMES.has(segment.toLowerCase()))) {
    return true;
  }
  const iosIndex = segments.indexOf('ios');
  const iosBuildDirectory = iosIndex >= 0 ? segments[iosIndex + 1] : undefined;
  return iosBuildDirectory !== undefined && /^build(?:-|$)/.test(iosBuildDirectory.toLowerCase());
}

function readGitPaths(output) {
  return output.toString('utf8').split('\0').filter(Boolean);
}

function filterInputPaths(paths) {
  return [...new Set(paths)].filter((path) => !isGeneratedPath(path)).sort();
}

function isDirectoryOrExactPathspec(pathspec) {
  return !['*', '?', '['].some((marker) => pathspec.includes(marker));
}

export function filterDetoxBuildInputPaths(paths) {
  return filterInputPaths(paths).filter((path) => !HOST_ONLY_DETOX_INPUT.test(path));
}

// Keep hashing and drift checks on the same input-selection boundary.
export function detoxInputPathspecs(pathspecs) {
  return [...pathspecs, ...GENERATED_PATHSPEC_EXCLUSIONS];
}

function listCurrentInputs(repositoryRoot, pathspecs) {
  // Dirty local builds can consume new non-ignored source files that Git has not indexed yet.
  const output = execFileSync(
    'git',
    [
      '-C',
      repositoryRoot,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...detoxInputPathspecs(pathspecs),
    ],
    { encoding: 'buffer' },
  );
  return filterInputPaths(readGitPaths(output));
}

function readNormalizedContents(repositoryRoot, path, inputHashes, readInput) {
  const absolutePath = join(repositoryRoot, path);
  const stat = lstatSync(absolutePath);
  const contents = stat.isSymbolicLink()
    ? Buffer.from(`symlink:${readlinkSync(absolutePath)}`)
    : readInput(absolutePath);
  if (path !== PRIVACY_MANIFEST_INPUT && path !== COCOAPODS_PROJECT_INPUT) return { contents };
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to normalize a symlinked CocoaPods build input: ${path}`);
  }

  const digest =
    (path === PRIVACY_MANIFEST_INPUT
      ? inputHashes.privacyManifestInputHash
      : inputHashes.cocoapodsProjectInputHash) ??
    createHash('sha256').update(contents).digest('hex');
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error(`Invalid CocoaPods input fingerprint for ${path}.`);
  }
  return {
    contents: Buffer.from(
      path === PRIVACY_MANIFEST_INPUT
        ? `privacy-manifest-sha256:${digest}`
        : `cocoapods-project-sha256:${digest}`,
    ),
    ...(path === PRIVACY_MANIFEST_INPUT
      ? { privacyManifestInputHash: digest }
      : { cocoapodsProjectInputHash: digest }),
  };
}

// Fingerprint groups overlap; this sorted union scan preserves cache keys and reads shared files once.
// The injectable reader lets tests count physical file reads while CI keeps the normal filesystem path.
export function hashInputGroups(
  repositoryRoot,
  groups,
  inputHashes = {},
  readInput = readFileSync,
) {
  const groupNames = Object.keys(groups);
  const pathspecs = [...new Set(groupNames.flatMap((name) => groups[name].pathspecs))];
  const allPaths = listCurrentInputs(repositoryRoot, pathspecs);
  const pathsByGroup = new Map();
  const groupsByPath = new Map();

  for (const name of groupNames) {
    const { pathspecs: groupPathspecs, excludeHostTests = false } = groups[name];
    const groupPaths =
      groupNames.length === 1
        ? allPaths
        : groupPathspecs.some((pathspec) => !isDirectoryOrExactPathspec(pathspec))
          ? listCurrentInputs(repositoryRoot, groupPathspecs)
          : allPaths.filter((path) =>
              groupPathspecs.some(
                (pathspec) => path === pathspec || path.startsWith(`${pathspec}/`),
              ),
            );
    const paths = excludeHostTests
      ? filterDetoxBuildInputPaths(groupPaths)
      : filterInputPaths(groupPaths);
    if (paths.length === 0) {
      throw new Error(`No tracked Detox cache inputs matched: ${groupPathspecs.join(', ')}`);
    }
    pathsByGroup.set(name, paths);
    for (const path of paths) {
      const names = groupsByPath.get(path) ?? [];
      names.push(name);
      groupsByPath.set(path, names);
    }
  }

  const hashers = new Map(groupNames.map((name) => [name, createHash('sha256')]));
  const fingerprints = new Map(groupNames.map((name) => [name, {}]));
  for (const path of [...groupsByPath.keys()].sort()) {
    const normalized = readNormalizedContents(repositoryRoot, path, inputHashes, readInput);
    for (const name of groupsByPath.get(path)) {
      const hash = hashers.get(name);
      hash.update(path);
      hash.update('\0');
      hash.update(normalized.contents);
      hash.update('\0');
      if (normalized.privacyManifestInputHash) {
        fingerprints.get(name).privacyManifestInputHash = normalized.privacyManifestInputHash;
      }
      if (normalized.cocoapodsProjectInputHash) {
        fingerprints.get(name).cocoapodsProjectInputHash = normalized.cocoapodsProjectInputHash;
      }
    }
  }

  return Object.fromEntries(
    groupNames.map((name) => [
      name,
      {
        fingerprint: hashers.get(name).digest('hex'),
        count: pathsByGroup.get(name).length,
        ...fingerprints.get(name),
      },
    ]),
  );
}

export function hashCurrentInputs(
  repositoryRoot,
  pathspecs,
  inputHashes = {},
  skipHostTests = false,
  readInput = readFileSync,
) {
  return hashInputGroups(
    repositoryRoot,
    { inputs: { pathspecs, excludeHostTests: skipHostTests } },
    inputHashes,
    readInput,
  ).inputs;
}
