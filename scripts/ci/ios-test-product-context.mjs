import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { iosTestBuildSpec } from './ios-test-config.mjs';

export function buildInputDigest(root) {
  // Hash the committed native/JS inputs before generated dependency setup rewrites metadata.
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256');
  for (const file of files
    .filter(
      (file) =>
        file.startsWith('apps/mobile/') ||
        file.startsWith('packages/') ||
        ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.nvmrc'].includes(file),
    )
    .sort()) {
    const bytes = execFileSync('git', ['-C', root, 'show', 'HEAD:' + file], {
      maxBuffer: 32 * 1024 * 1024,
    });
    hash.update(JSON.stringify([file, bytes.length]));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function productContext(root, profile, env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true')
    throw new Error('Run-bound native products require GitHub Actions');
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
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'package.json',
      '.nvmrc',
    ],
    { encoding: 'utf8' },
  ).trim();
  if (changes) throw new Error('Native product source inputs differ from the committed head');
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(attempt) ||
    attempt <= 0 ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
    sha !== env.GITHUB_SHA
  )
    throw new Error('Native product source/run identity mismatch');
  const spec = iosTestBuildSpec(profile);
  const xcode = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8', env }).trim();
  const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], {
    encoding: 'utf8',
    env,
  }).trim();
  const platform = execFileSync('uname', ['-s'], { encoding: 'utf8', env }).trim();
  const architecture = execFileSync('uname', ['-m'], { encoding: 'utf8', env }).trim();
  if (
    xcode.split('\n')[0] !== 'Xcode ' + spec.xcode ||
    sdk !== spec.sdk ||
    platform !== 'Darwin' ||
    architecture !== spec.architecture
  )
    throw new Error('Native product toolchain mismatch');
  return {
    runId,
    attempt,
    sourceSha: sha,
    profile: spec.productProfile,
    spec,
    inputDigest: buildInputDigest(root),
    configurationDigest: createHash('sha256').update(JSON.stringify(spec)).digest('hex'),
    toolchain: {
      xcode,
      sdk,
      platform,
      architecture,
      macOS: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8', env }).trim(),
      developerDirectory: execFileSync('xcode-select', ['-p'], { encoding: 'utf8', env }).trim(),
      node: env.EXPECTED_NODE_VERSION ?? process.version,
      podLockDigest: createHash('sha256')
        .update(readFileSync(join(root, 'apps/mobile/ios/Podfile.lock')))
        .digest('hex'),
    },
  };
}
