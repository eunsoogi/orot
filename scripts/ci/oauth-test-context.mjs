import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const packagePath = 'packages/provider-openai';
const command = (program, args) => execFileSync(program, args, { encoding: 'utf8' }).trim();

/** OAuth products bind the package's committed inputs, not integration-app flags or another workflow attempt. */
export function oauthInputDigest(root = process.cwd()) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z', packagePath], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = execFileSync('git', ['-C', root, 'show', 'HEAD:' + file], {
      maxBuffer: 32 * 1024 * 1024,
    });
    hash.update(JSON.stringify([file, bytes.length]));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function oauthTestContext(env = process.env) {
  const sourceSha = command('git', ['rev-parse', 'HEAD']);
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    sourceSha !== env.GITHUB_SHA ||
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
  )
    throw new Error('OAuth products require their actual hosted source/run identity');
  if (command('git', ['status', '--porcelain', '--untracked-files=all', '--', packagePath]))
    throw new Error('OAuth package inputs differ from the committed head');
  const toolchain = {
    xcode: command('xcodebuild', ['-version']),
    swift: command('swift', ['--version']),
    macOS: command('sw_vers', ['-productVersion']),
    architecture: command('uname', ['-m']),
  };
  if (
    process.platform !== 'darwin' ||
    toolchain.xcode.split('\n')[0] !== 'Xcode 27.0' ||
    toolchain.architecture !== 'arm64'
  )
    throw new Error('OAuth product toolchain mismatch');
  return {
    sourceSha,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    profile: 'oauth-macos',
    configuration: 'Debug',
    inputDigest: oauthInputDigest(),
    toolchain,
  };
}

/** XCTest prints its environment on certain loader failures. Pass only execution necessities, never account or CI credentials. */
export function oauthTestEnvironment(env = process.env) {
  return Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'DEVELOPER_DIR', 'SDKROOT', 'LANG', 'LC_ALL']
      .filter((name) => env[name] !== undefined)
      .map((name) => [name, env[name]]),
  );
}
