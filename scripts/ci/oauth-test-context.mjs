import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  iosSimulatorSdk,
  iosXcodeDeveloperDirectory,
  iosXcodeVersion,
} from './ios-test-config.mjs';

const packagePath = 'packages/provider-openai';
const command = (program, args, env = process.env) =>
  execFileSync(program, args, { encoding: 'utf8', env }).trim();

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

/** Reject stale or differently selected tools before OAuth products can be transferred or executed. */
export function assertOAuthToolchain(toolchain) {
  const actualXcode =
    typeof toolchain.xcode === 'string' ? toolchain.xcode.split('\n')[0] : String(toolchain.xcode);
  const expected =
    'Xcode ' +
    iosXcodeVersion +
    ', iOS Simulator SDK ' +
    iosSimulatorSdk +
    ', platform Darwin, architecture arm64, developer directory ' +
    iosXcodeDeveloperDirectory;
  const actual =
    actualXcode +
    ', iOS Simulator SDK ' +
    toolchain.sdk +
    ', platform ' +
    toolchain.platform +
    ', architecture ' +
    toolchain.architecture +
    ', developer directory ' +
    (toolchain.developerDirectory || '(unset)');
  if (
    actualXcode !== 'Xcode ' + iosXcodeVersion ||
    toolchain.sdk !== iosSimulatorSdk ||
    toolchain.platform !== 'Darwin' ||
    toolchain.architecture !== 'arm64' ||
    toolchain.developerDirectory !== iosXcodeDeveloperDirectory
  )
    throw new Error(
      'OAuth product toolchain mismatch: expected ' + expected + '; actual ' + actual,
    );
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
    xcode: command('xcodebuild', ['-version'], env),
    sdk: command('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], env),
    swift: command('swift', ['--version'], env),
    macOS: command('sw_vers', ['-productVersion'], env),
    platform: process.platform === 'darwin' ? 'Darwin' : process.platform,
    architecture: command('uname', ['-m'], env),
    developerDirectory: env.DEVELOPER_DIR ?? '',
  };
  assertOAuthToolchain(toolchain);
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
