// Own app-bundle hashing, archive path checks, and rollback-safe installation of a verified product.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getProfile, inspectCachedApp } from './ios-derived-data-cache-paths.mjs';
import { PROFILE, fail } from './detox-release-app-artifact-context.mjs';

export function fileSha256(path) {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveDigest(hash.digest('hex')));
  });
}

// Hash file bytes and metadata in sorted path order; reject links that can escape the app bundle.
async function updateTreeHash(hash, root, directory, relativeDirectory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const relativePath = relativeDirectory ? relativeDirectory + '/' + name : name;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      const resolvedTarget = resolve(dirname(path), target);
      const relativeTarget = relative(root, resolvedTarget);
      if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
        fail('app bundle contains a symbolic link that escapes its root: ' + relativePath);
      }
      hash.update('link\0' + relativePath + '\0' + target + '\0');
    } else if (stat.isDirectory()) {
      hash.update('directory\0' + relativePath + '\0' + (stat.mode & 0o7777) + '\0');
      await updateTreeHash(hash, root, path, relativePath);
    } else if (stat.isFile()) {
      hash.update('file\0' + relativePath + '\0' + (stat.mode & 0o7777) + '\0');
      hash.update(await fileSha256(path));
      hash.update('\0');
    } else {
      fail('app bundle contains an unsupported filesystem entry: ' + relativePath);
    }
  }
}

export async function hashAppBundle(appPath) {
  const stat = lstatSync(appPath);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    fail('app bundle root must be a real directory.');
  const root = resolve(appPath);
  const hash = createHash('sha256');
  hash.update('directory\0.\0' + (stat.mode & 0o7777) + '\0');
  await updateTreeHash(hash, root, root, '');
  return hash.digest('hex');
}

export function assertRegularFile(path, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') fail(label + ' is missing.');
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(label + ' must be a regular file.');
}

export function assertArtifactDirectory(path, create) {
  if (create) mkdirSync(path, { recursive: true });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    fail('artifact location must be a real directory.');
}

export function validateArchivePaths(archivePath, environment) {
  const productPath = getProfile(PROFILE).productPath;
  const entries = execFileSync('tar', ['-tf', archivePath], {
    encoding: 'utf8',
    env: environment,
  })
    .split(/\r?\n/)
    .filter(Boolean);
  if (entries.length === 0) fail('app archive is empty.');
  for (const entry of entries) {
    const normalized = entry.replace(/\/+$/, '');
    const segments = normalized.split('/');
    if (
      normalized.startsWith('/') ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      (normalized !== productPath && !normalized.startsWith(productPath + '/'))
    ) {
      fail('app archive contains an unexpected path: ' + entry);
    }
  }
}

// A same-directory rename publishes only a complete manifest to concurrent readers.
export function writeManifest(manifestPath, manifest) {
  const temporaryPath = manifestPath + '.tmp-' + process.pid;
  writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  renameSync(temporaryPath, manifestPath);
}

function ensureRealDirectory(root, relativePath) {
  let current = root;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (!existsSync(current)) mkdirSync(current);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail('refusing to install through an unsafe app output path: ' + current);
    }
  }
  return current;
}

// Keep the previous app until the imported product passes tree and Detox metadata validation.
export async function installVerifiedApp(dataRoot, stagedRoot, manifest) {
  const profileConfig = getProfile(PROFILE);
  const productPath = profileConfig.productPath;
  const stagedProduct = join(stagedRoot, productPath);
  const productParent = ensureRealDirectory(dataRoot, dirname(productPath));
  const destination = join(productParent, productPath.split('/').at(-1));
  const backup = destination + '.previous-' + process.pid;
  if (existsSync(backup)) fail('a previous app installation backup already exists.');
  if (existsSync(destination)) {
    const stat = lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('existing app output is unsafe.');
    renameSync(destination, backup);
  }
  let installed = false;
  try {
    renameSync(stagedProduct, destination);
    installed = true;
    const treeSha256 = await hashAppBundle(destination);
    const app = inspectCachedApp(PROFILE, dataRoot, manifest.app.cacheArtifacts);
    if (treeSha256 !== manifest.app.treeSha256 || app.reason) {
      fail('installed app bundle failed its integrity or metadata check.');
    }
    if (existsSync(backup)) rmSync(backup, { recursive: true });
    return treeSha256;
  } catch (error) {
    if (installed && existsSync(destination)) rmSync(destination, { recursive: true, force: true });
    if (existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
}
