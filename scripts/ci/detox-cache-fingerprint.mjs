import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD_INPUT_PATHS = [
  '.github/workflows/ci.yml',
  '.github/workflows/detox-e2e-profile.yml',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/mobile',
  'packages',
  'scripts/ci/build-detox-apps.sh',
  'scripts/ci/detox-cache-fingerprint.mjs',
];

const REACT_NATIVE_ARTIFACT_PATHS = [
  'pnpm-lock.yaml',
  'apps/mobile/ios/Podfile.lock',
];

const GENERATED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'pods',
  '.cache',
  'deriveddata',
  'coresimulator',
  'simulator',
  'keychains',
]);

function isGeneratedPath(path) {
  const segments = path.split('/');
  if (segments.some(segment => GENERATED_DIRECTORY_NAMES.has(segment.toLowerCase()))) {
    return true;
  }
  const iosIndex = segments.indexOf('ios');
  const iosBuildDirectory = iosIndex >= 0 ? segments[iosIndex + 1] : undefined;
  return iosBuildDirectory !== undefined && /^build(?:-|$)/.test(iosBuildDirectory.toLowerCase());
}

function listTrackedInputs(repositoryRoot, pathspecs) {
  const output = execFileSync(
    'git',
    ['-C', repositoryRoot, 'ls-files', '-z', '--', ...pathspecs],
    { encoding: 'buffer' },
  );
  return output
    .toString('utf8')
    .split('\0')
    .filter(path => path && !isGeneratedPath(path))
    .sort();
}

function hashTrackedInputs(repositoryRoot, pathspecs) {
  const paths = listTrackedInputs(repositoryRoot, pathspecs);
  if (paths.length === 0) throw new Error(`No tracked Detox cache inputs matched: ${pathspecs.join(', ')}`);

  const hash = createHash('sha256');
  for (const path of paths) {
    const absolutePath = join(repositoryRoot, path);
    const stat = lstatSync(absolutePath);
    const contents = stat.isSymbolicLink()
      ? Buffer.from(`symlink:${readlinkSync(absolutePath)}`)
      : readFileSync(absolutePath);
    hash.update(path);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return { fingerprint: hash.digest('hex'), count: paths.length };
}

export function computeDetoxCacheFingerprints(repositoryRoot = process.cwd()) {
  const root = resolve(repositoryRoot);
  const buildInputs = hashTrackedInputs(root, BUILD_INPUT_PATHS);
  const reactNativeArtifacts = hashTrackedInputs(root, REACT_NATIVE_ARTIFACT_PATHS);
  return {
    buildInputs: buildInputs.fingerprint,
    buildInputCount: buildInputs.count,
    reactNativeArtifacts: reactNativeArtifacts.fingerprint,
    reactNativeArtifactInputCount: reactNativeArtifacts.count,
  };
}

function writeGitHubOutputs(outputPath, fingerprints) {
  appendFileSync(
    outputPath,
    `build_inputs=${fingerprints.buildInputs}\nreact_native_artifacts=${fingerprints.reactNativeArtifacts}\n`,
  );
}

function main() {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error('GITHUB_OUTPUT is required to publish Detox cache fingerprints.');
  const fingerprints = computeDetoxCacheFingerprints();
  writeGitHubOutputs(outputPath, fingerprints);
  console.log(
    `DETOX_CACHE_FINGERPRINT build_inputs=${fingerprints.buildInputs} tracked_files=${fingerprints.buildInputCount} react_native_artifacts=${fingerprints.reactNativeArtifacts} lockfiles=${fingerprints.reactNativeArtifactInputCount}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
