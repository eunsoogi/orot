import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ARTIFACT_DIRECTORIES = [
  ['framework', 'framework'],
  ['xcuitestRunner', 'xcuitest-runner'],
];

export function getDetoxFrameworkCacheRoot() {
  return resolve(
    process.env.OROT_DETOX_FRAMEWORK_CACHE_ROOT ?? join(homedir(), 'Library/Detox/ios'),
  );
}

// Remove only Detox-owned outputs before a fallback restore, without traversing symlinks.
export function clearDetoxFrameworkCacheArtifacts(root = getDetoxFrameworkCacheRoot()) {
  const rootPath = resolve(root);
  let rootStat;
  try {
    rootStat = lstatSync(rootPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Refusing to clear an unsafe Detox framework cache root: ${rootPath}`);
  }

  for (const [, directory] of ARTIFACT_DIRECTORIES) {
    const artifactPath = join(rootPath, directory);
    let stat;
    try {
      stat = lstatSync(artifactPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) unlinkSync(artifactPath);
    else if (stat.isDirectory()) rmSync(artifactPath, { recursive: true });
    else throw new Error(`Refusing to clear a non-directory Detox cache output: ${artifactPath}`);
  }
}

function inspectDirectory(root, name) {
  const hash = createHash('sha256');
  let fileCount = 0;
  let totalBytes = 0;

  function visit(directory, prefix = '') {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) return 'detox_artifact_symlink';
      if (stat.isDirectory()) {
        const failure = visit(absolutePath, relativePath);
        if (failure) return failure;
        continue;
      }
      if (!stat.isFile()) return 'detox_artifact_not_regular_file';
      const fileDigest = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
      hash.update(`${relativePath}\0${stat.size}\0${stat.mode & 0o777}\0${fileDigest}\0`);
      fileCount += 1;
      totalBytes += stat.size;
    }
    return null;
  }

  let stat;
  try {
    stat = lstatSync(root);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const label = name === 'xcuitestRunner' ? 'xcuitest_runner' : name;
      return { reason: `detox_${label}_missing` };
    }
    throw error;
  }
  if (stat.isSymbolicLink()) return { reason: 'detox_artifact_symlink' };
  if (!stat.isDirectory()) return { reason: 'detox_artifact_not_directory' };

  const reason = visit(root);
  if (reason) return { reason };
  if (fileCount === 0) {
    const label = name === 'xcuitestRunner' ? 'xcuitest_runner' : name;
    return { reason: `detox_${label}_empty` };
  }
  return {
    artifact: { fileCount, totalBytes, sha256: hash.digest('hex') },
    reason: null,
  };
}

function isArtifactManifest(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'framework,xcuitestRunner' &&
    ARTIFACT_DIRECTORIES.every(([key]) => {
      const artifact = value[key];
      return (
        artifact !== null &&
        typeof artifact === 'object' &&
        !Array.isArray(artifact) &&
        Object.keys(artifact).sort().join(',') === 'fileCount,sha256,totalBytes' &&
        Number.isSafeInteger(artifact.fileCount) &&
        artifact.fileCount > 0 &&
        Number.isSafeInteger(artifact.totalBytes) &&
        artifact.totalBytes >= 0 &&
        typeof artifact.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(artifact.sha256)
      );
    })
  );
}

// Hash relative paths, contents, and modes because Detox stores reusable runtime outputs outside DerivedData.
export function inspectDetoxFrameworkCacheArtifacts(root, expected = undefined) {
  if (expected !== undefined && !isArtifactManifest(expected)) {
    return { artifacts: null, reason: 'detox_artifact_manifest_missing' };
  }

  const rootPath = resolve(root);
  let rootStat;
  try {
    rootStat = lstatSync(rootPath);
  } catch (error) {
    if (error.code === 'ENOENT') return { artifacts: null, reason: 'detox_framework_root_missing' };
    throw error;
  }
  if (rootStat.isSymbolicLink()) return { artifacts: null, reason: 'detox_artifact_symlink' };
  if (!rootStat.isDirectory()) return { artifacts: null, reason: 'detox_artifact_not_directory' };

  const artifacts = {};
  for (const [key, directory] of ARTIFACT_DIRECTORIES) {
    const inspected = inspectDirectory(join(rootPath, directory), key);
    if (inspected.reason) return { artifacts: null, reason: inspected.reason };
    artifacts[key] = inspected.artifact;
  }
  if (
    expected &&
    ARTIFACT_DIRECTORIES.some(([key]) =>
      ['fileCount', 'totalBytes', 'sha256'].some(
        (field) => artifacts[key][field] !== expected[key][field],
      ),
    )
  ) {
    return { artifacts, reason: 'detox_artifact_digest_mismatch' };
  }
  return { artifacts, reason: null };
}
