import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { provider } from './fixtures/ios-fabric-provider.mjs';

function withBuildStub(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-resolved-build-'));
  try {
    const capture = join(directory, 'args.json');
    // Use the real scripts but never generate or modify any files under the source checkout.
    symlinkSync(resolve('scripts'), join(directory, 'scripts'), 'dir');
    writeFileSync(join(directory, 'fabric-fixture.mm'), provider());
    writeFileSync(
      join(directory, 'xcodebuild'),
      `#!${process.execPath}
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
writeFileSync('args.json', JSON.stringify(process.argv.slice(2)));
const status = Number(process.env.BUILD_STATUS);
const mode = process.env.FABRIC_OUTPUT;
const output = 'apps/mobile/ios/build/generated/ios/ReactCodegen/RCTThirdPartyComponentsProvider.mm';
if (status === 0 && mode !== 'missing') {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, mode === 'valid' ? readFileSync('fabric-fixture.mm') : '/* missing registrations */');
}
process.exit(status);
`,
      { mode: 0o755 },
    );
    callback((profile, status, fabricOutput = 'valid') => {
      const result = spawnSync(
        process.execPath,
        ['scripts/ci/build-ios-tests.mjs', profile, join(directory, 'products')],
        {
          cwd: directory,
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            GITHUB_ACTIONS: 'false',
            PATH: directory + ':' + process.env.PATH,
            BUILD_STATUS: String(status),
            FABRIC_OUTPUT: fabricOutput,
          },
        },
      );
      return { ...result, args: JSON.parse(readFileSync(capture, 'utf8')) };
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertBuildStatus(result, status) {
  assert.equal(result.status, status, result.stderr);
  assert.deepEqual(
    [...result.stdout.matchAll(/^IOS_BUILD_STAGE elapsed_ms=\d+ exit=(\d+)$/gm)].map((match) =>
      Number(match[1]),
    ),
    [status],
  );
}

// Replace only the external executable; exercise the canonical runner and its warning/exit wrapper.
for (const profile of ['core', 'provider-data', 'duo']) {
  test(`canonical ${profile} build preserves resolved-only arguments and failure status`, () => {
    withBuildStub((build) => {
      for (const status of [0, 74]) {
        const result = build(profile, status);
        assertBuildStatus(result, status);
        const proof = result.stdout.indexOf('Verified iOS Fabric registrations: 5; SHA-256:');
        if (status === 0) {
          assert.ok(proof >= 0);
          assert.ok(proof < result.stdout.indexOf('IOS_BUILD_STAGE'));
        } else {
          assert.equal(proof, -1);
        }
        assert.equal(result.args[0], 'build-for-testing');
        for (const flag of [
          '-disableAutomaticPackageResolution',
          '-onlyUsePackageVersionsFromResolvedFile',
        ]) {
          assert.equal(
            result.args.filter((value) => value === flag).length,
            1,
            `${profile} missing ${flag}`,
          );
        }
        assert.ok(result.args.includes('generic/platform=iOS Simulator'));
        assert.ok(result.args.includes('CODE_SIGNING_ALLOWED=YES'));
      }
    });
  });
}

for (const mode of ['missing', 'invalid']) {
  test(`a successful Xcode command with ${mode} Fabric output never reports a successful build`, () => {
    withBuildStub((build) => {
      const result = build('core', 0, mode);
      assertBuildStatus(result, 1);
      assert.doesNotMatch(result.stdout, /Verified iOS Fabric registrations/);
      assert.match(result.stderr, /ENOENT|Unexpected generated Fabric provider structure/);
    });
  });
}
