// Coordinate verified artifact production and consumption; provenance and filesystem rules live in focused helpers.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  getDerivedDataRoot,
  getProfile,
  inspectCachedApp,
} from './ios-derived-data-cache-paths.mjs';
import {
  ARCHIVE_NAME,
  MANIFEST_NAME,
  PROFILE,
  SCHEMA_VERSION,
  appendOutputs,
  collectBuildContext,
  fail,
  requireActions,
} from './detox-release-app-artifact-context.mjs';
import {
  assertArtifactDirectory,
  assertRegularFile,
  fileSha256,
  hashAppBundle,
  installVerifiedApp,
  validateArchivePaths,
  writeManifest,
} from './detox-release-app-artifact-bundle.mjs';

export async function createReleaseAppArtifact({ repositoryRoot, artifactDirectory, environment }) {
  requireActions(environment);
  const root = resolve(repositoryRoot);
  const directory = resolve(artifactDirectory);
  assertArtifactDirectory(directory, true);
  const archivePath = join(directory, ARCHIVE_NAME);
  const manifestPath = join(directory, MANIFEST_NAME);
  if (existsSync(archivePath) || existsSync(manifestPath))
    fail('refusing to replace a prior artifact.');

  const profileConfig = getProfile(PROFILE);
  const dataRoot = getDerivedDataRoot(root, PROFILE);
  if (!existsSync(dataRoot)) fail('refusing to publish an invalid app bundle: app_product_missing');
  const app = inspectCachedApp(PROFILE, dataRoot);
  if (app.reason) fail('refusing to publish an invalid app bundle: ' + app.reason);
  const appPath = join(dataRoot, profileConfig.productPath);
  const appTreeSha256 = await hashAppBundle(appPath);
  const buildContext = collectBuildContext(root, environment);
  execFileSync('tar', ['-cf', archivePath, '-C', dataRoot, profileConfig.productPath], {
    env: environment,
    stdio: 'inherit',
  });
  const archiveSha256 = await fileSha256(archivePath);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    profile: PROFILE,
    buildContext,
    app: { cacheArtifacts: app.artifacts, treeSha256: appTreeSha256, archiveSha256 },
  };
  writeManifest(manifestPath, manifest);
  const manifestSha256 = createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
  appendOutputs(environment, {
    release_app_archive_sha256: archiveSha256,
    release_app_manifest_sha256: manifestSha256,
  });
  return { archivePath, manifestPath, archiveSha256, manifestSha256, manifest };
}

export async function verifyReleaseAppArtifact({
  repositoryRoot,
  artifactDirectory,
  expectedArchiveSha256,
  expectedManifestSha256,
  environment,
}) {
  requireActions(environment);
  const root = resolve(repositoryRoot);
  const directory = resolve(artifactDirectory);
  assertArtifactDirectory(directory, false);
  const archivePath = join(directory, ARCHIVE_NAME);
  const manifestPath = join(directory, MANIFEST_NAME);
  assertRegularFile(archivePath, 'app archive');
  assertRegularFile(manifestPath, 'app manifest');

  const manifestBytes = readFileSync(manifestPath);
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  if (manifestSha256 !== expectedManifestSha256)
    fail('app manifest digest does not match producer output.');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest?.schemaVersion !== SCHEMA_VERSION ||
    manifest?.profile !== PROFILE ||
    !manifest.app?.cacheArtifacts ||
    !/^[a-f0-9]{64}$/.test(manifest.app.treeSha256 ?? '')
  ) {
    fail('app manifest is incomplete or uses an incompatible profile.');
  }
  // Recompute provenance on the consuming runner instead of trusting producer-supplied fields.
  const buildContext = collectBuildContext(root, environment);
  if (!isDeepStrictEqual(manifest.buildContext, buildContext)) {
    fail('app artifact provenance does not match this workflow run or build configuration.');
  }

  const archiveSha256 = await fileSha256(archivePath);
  if (archiveSha256 !== expectedArchiveSha256 || archiveSha256 !== manifest.app.archiveSha256) {
    fail('app archive digest does not match producer output.');
  }
  validateArchivePaths(archivePath, environment);

  const profileConfig = getProfile(PROFILE);
  const dataRoot = getDerivedDataRoot(root, PROFILE);
  mkdirSync(dataRoot, { recursive: true });
  const stagedRoot = mkdtempSync(join(dataRoot, '.orot-release-artifact-'));
  try {
    execFileSync('tar', ['-xf', archivePath, '-C', stagedRoot], {
      env: environment,
      stdio: 'inherit',
    });
    const stagedApp = join(stagedRoot, profileConfig.productPath);
    const stagedTreeSha256 = await hashAppBundle(stagedApp);
    const stagedValidation = inspectCachedApp(PROFILE, stagedRoot, manifest.app.cacheArtifacts);
    if (stagedTreeSha256 !== manifest.app.treeSha256 || stagedValidation.reason) {
      fail('downloaded app bundle failed its integrity or metadata check.');
    }
    const installedTreeSha256 = await installVerifiedApp(dataRoot, stagedRoot, manifest);
    appendOutputs(environment, {
      release_app_reusable: 'true',
      release_app_tree_sha256: installedTreeSha256,
    });
    return { archiveSha256, manifestSha256, treeSha256: installedTreeSha256 };
  } finally {
    rmSync(stagedRoot, { recursive: true, force: true });
  }
}

async function main() {
  const [command, artifactDirectory, archiveSha256, manifestSha256, ...extra] =
    process.argv.slice(2);
  if (extra.length > 0 || !['create', 'verify'].includes(command) || !artifactDirectory) {
    fail(
      'usage: detox-release-app-artifact.mjs <create <artifact-directory>|verify <artifact-directory> <archive-sha256> <manifest-sha256>>',
    );
  }
  if (command === 'create') {
    const result = await createReleaseAppArtifact({
      repositoryRoot: process.cwd(),
      artifactDirectory,
      environment: process.env,
    });
    console.log(
      'DETOX_RELEASE_APP_ARTIFACT produced profile=release archive_sha256=' +
        result.archiveSha256 +
        ' manifest_sha256=' +
        result.manifestSha256,
    );
    return;
  }
  if (!archiveSha256 || !manifestSha256)
    fail('verify requires producer archive and manifest digests.');
  const result = await verifyReleaseAppArtifact({
    repositoryRoot: process.cwd(),
    artifactDirectory,
    expectedArchiveSha256: archiveSha256,
    expectedManifestSha256: manifestSha256,
    environment: process.env,
  });
  console.log(
    'DETOX_RELEASE_APP_ARTIFACT verified profile=release app_reusable=true tree_sha256=' +
      result.treeSha256,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
