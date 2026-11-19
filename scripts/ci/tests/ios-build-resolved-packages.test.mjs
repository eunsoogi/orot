import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Replace only the external executable; exercise the canonical runner and its warning/exit wrapper.
for (const profile of ['core', 'provider-data', 'duo']) {
  test(`canonical ${profile} build preserves resolved-only arguments and failure status`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-resolved-build-'));
    try {
      const capture = join(directory, 'args.json');
      writeFileSync(
        join(directory, 'xcodebuild'),
        `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.BUILD_STATUS));\n`,
        { mode: 0o755 },
      );
      for (const status of [0, 74]) {
        const result = spawnSync(
          process.execPath,
          ['scripts/ci/build-ios-tests.mjs', profile, join(directory, 'products')],
          {
            cwd: resolve('.'),
            encoding: 'utf8',
            timeout: 30000,
            env: {
              ...process.env,
              GITHUB_ACTIONS: 'false',
              PATH: directory + ':' + process.env.PATH,
              CAPTURE: capture,
              BUILD_STATUS: String(status),
            },
          },
        );
        assert.equal(result.status, status, result.stderr);
        const args = JSON.parse(readFileSync(capture, 'utf8'));
        assert.equal(args[0], 'build-for-testing');
        for (const flag of [
          '-disableAutomaticPackageResolution',
          '-onlyUsePackageVersionsFromResolvedFile',
        ]) {
          assert.equal(
            args.filter((value) => value === flag).length,
            1,
            `${profile} missing ${flag}`,
          );
        }
        assert.ok(args.includes('generic/platform=iOS Simulator'));
        assert.ok(args.includes('CODE_SIGNING_ALLOWED=YES'));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
