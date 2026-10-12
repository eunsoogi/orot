import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** These are transport fixtures, not compiled binaries or authentic hosted-run evidence. */
export function createProductFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ios-product-fixture-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const originalDirectory = process.cwd();
  const originalPath = process.env.PATH;
  function command(name, body) {
    writeFileSync(join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  }
  command(
    'xcodebuild',
    'test "$1" = -version || exit 17\nprintf "Xcode 27.0\\nBuild version 27A266a\\n"',
  );
  command(
    'xcrun',
    'if test "$1" = --sdk; then printf "27.0\\n"; elif test "$1" = lipo; then printf "arm64\\n"; else exit 17; fi',
  );
  command('uname', 'if test "$1" = -s; then printf "Darwin\\n"; else printf "arm64\\n"; fi');
  command('sw_vers', 'printf "27.0.1\\n"');
  command('xcode-select', 'printf "/Applications/Xcode.app/Contents/Developer\\n"');
  command('plutil', 'for argument in "$@"; do candidate="$argument"; done\ncat "$candidate"');
  const source = join(root, 'source');
  mkdirSync(join(source, 'apps/mobile/ios'), { recursive: true });
  writeFileSync(join(source, 'apps/mobile/ios/Podfile.lock'), 'SYNTHETIC LOCK INPUT\n');
  for (const args of [
    ['init', '--quiet'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '--', 'apps/mobile/ios/Podfile.lock'],
    ['commit', '--quiet', '-m', 'test: initialize transport fixture'],
  ])
    execFileSync('git', args, { cwd: source });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  const products = join(root, 'input-products');
  const configuration = 'Release-iphonesimulator';
  const app = `__TESTROOT__/${configuration}/Orot.app`;
  const runner = `__TESTROOT__/${configuration}/OrotUITests-Runner.app`;
  const dependencies = [
    app,
    app + '/PlugIns/OrotIntegrationTests.xctest',
    runner,
    runner + '/PlugIns/OrotUITests.xctest',
  ];
  const shared = {
    CommandLineArguments: ['-OROT_TEST_HOST', 'YES'],
    DependentProductPaths: dependencies,
  };
  const testRun = {
    __xctestrun_metadata__: {
      FormatVersion: 1,
      ContainerInfo: { ContainerName: 'OrotMobile', SchemeName: 'OrotTests' },
    },
    OrotIntegrationTests: {
      ...shared,
      BlueprintName: 'OrotIntegrationTests',
      IsAppHostedTestBundle: true,
      TestHostPath: app,
      TestBundlePath: '__TESTHOST__/PlugIns/OrotIntegrationTests.xctest',
    },
    OrotUITests: {
      ...shared,
      BlueprintName: 'OrotUITests',
      IsUITestBundle: true,
      IsXCTRunnerHostedTestBundle: true,
      TestHostPath: runner,
      TestBundlePath: '__TESTHOST__/PlugIns/OrotUITests.xctest',
      UITargetAppPath: app,
    },
  };
  mkdirSync(products);
  writeFileSync(
    join(products, 'OrotTests_iphonesimulator27.0-arm64.xctestrun'),
    JSON.stringify(testRun),
  );
  for (const path of [
    'Orot.app/Orot',
    'Orot.app/PlugIns/OrotIntegrationTests.xctest/OrotIntegrationTests',
    'OrotUITests-Runner.app/PlugIns/OrotUITests.xctest/OrotUITests',
  ]) {
    const file = join(products, configuration, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'SYNTHETIC EXECUTABLE FIXTURE\n', { mode: 0o755 });
  }
  process.env.PATH = bin + ':' + originalPath;
  process.chdir(source);
  const env = {
    ...process.env,
    GITHUB_ACTIONS: 'true',
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '1',
    EXPECTED_NODE_VERSION: '22.23.2',
  };
  delete env.GITHUB_OUTPUT;
  delete env.GITHUB_ENV;
  return {
    root,
    products,
    env,
    source,
    artifact: (name) => join(root, name),
    readManifest: (directory) => JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')),
    dispose() {
      process.chdir(originalDirectory);
      process.env.PATH = originalPath;
      rmSync(root, { recursive: true, force: true });
    },
  };
}
