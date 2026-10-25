import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { iosTestBuildSpec, iosXcodeDeveloperDirectory } from './ios-test-config.mjs';

// Keep repository identity reads independent of the selected Apple developer directory.
function repositoryEnvironment(env) {
  const result = { ...env };
  delete result.DEVELOPER_DIR;
  return result;
}

export function buildInputDigest(root, env = process.env) {
  // Hash app, package, and dependency-patch inputs before generated setup rewrites metadata.
  const gitEnv = repositoryEnvironment(env);
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    env: gitEnv,
  })
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256');
  for (const file of files
    .filter(
      (file) =>
        file.startsWith('apps/mobile/') ||
        file.startsWith('packages/') ||
        file.startsWith('vendor/patches/') ||
        ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.nvmrc'].includes(file),
    )
    .sort()) {
    const bytes = execFileSync('git', ['-C', root, 'show', 'HEAD:' + file], {
      maxBuffer: 32 * 1024 * 1024,
      env: gitEnv,
    });
    hash.update(JSON.stringify([file, bytes.length]));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function productContext(root, profile, env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true')
    throw new Error('Run-bound integration products require GitHub Actions');
  const gitEnv = repositoryEnvironment(env);
  // A HEAD digest cannot describe modified build inputs. Generated dependency outputs
  // live outside these tracked sources; producers and consumers must preserve checkout bytes.
  const changes = execFileSync(
    'git',
    [
      '-C',
      root,
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      'apps/mobile',
      'packages',
      'vendor/patches',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'package.json',
      '.nvmrc',
    ],
    { encoding: 'utf8', env: gitEnv },
  ).trim();
  if (changes)
    throw new Error('iOS product source inputs differ from the committed head:\n' + changes);
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    env: gitEnv,
  }).trim();
  if (
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(attempt) ||
    attempt <= 0 ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
    sha !== env.GITHUB_SHA
  )
    throw new Error('iOS product source/run identity mismatch');
  const spec = iosTestBuildSpec(profile);
  const xcode = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8', env }).trim();
  const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], {
    encoding: 'utf8',
    env,
  }).trim();
  const platform = execFileSync('uname', ['-s'], { encoding: 'utf8', env }).trim();
  const architecture = execFileSync('uname', ['-m'], { encoding: 'utf8', env }).trim();
  // Keep the requested versioned path in provenance; xcode-select may resolve its symlink differently across image releases.
  const developerDirectory = env.DEVELOPER_DIR ?? '';
  if (
    xcode.split('\n')[0] !== 'Xcode ' + spec.xcode ||
    sdk !== spec.sdk ||
    platform !== 'Darwin' ||
    architecture !== spec.architecture ||
    developerDirectory !== iosXcodeDeveloperDirectory
  ) {
    throw new Error(
      'iOS product toolchain mismatch: expected Xcode ' +
        spec.xcode +
        ', iOS Simulator SDK ' +
        spec.sdk +
        ', platform Darwin, architecture ' +
        spec.architecture +
        ', developer directory ' +
        iosXcodeDeveloperDirectory +
        '; actual ' +
        xcode.split('\n')[0] +
        ', iOS Simulator SDK ' +
        sdk +
        ', platform ' +
        platform +
        ', architecture ' +
        architecture +
        ', developer directory ' +
        (developerDirectory || '(unset)'),
    );
  }
  return {
    runId,
    attempt,
    sourceSha: sha,
    profile: spec.productProfile,
    spec,
    inputDigest: buildInputDigest(root, env),
    configurationDigest: createHash('sha256').update(JSON.stringify(spec)).digest('hex'),
    toolchain: {
      xcode,
      sdk,
      platform,
      architecture,
      macOS: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8', env }).trim(),
      developerDirectory,
      node: env.EXPECTED_NODE_VERSION ?? process.version,
      podLockDigest: createHash('sha256')
        .update(readFileSync(join(root, 'apps/mobile/ios/Podfile.lock')))
        .digest('hex'),
    },
  };
}
