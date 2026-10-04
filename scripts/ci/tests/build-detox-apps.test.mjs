import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const builder = join(repositoryRoot, 'scripts/ci/build-detox-apps.sh');

function runBuilder(profile = 'all') {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-build-profiles-'));
  const binDirectory = join(directory, 'bin');
  const callsPath = join(directory, 'pnpm-calls.log');
  const fakePnpm = join(binDirectory, 'pnpm');
  const fakeXcrun = join(binDirectory, 'xcrun');
  const releaseDerivedData = join(directory, 'release-derived-data');
  const debugDerivedData = join(directory, 'debug-derived-data');
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(fakePnpm, [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$*" >> "$BUILD_CALLS"',
    'if [[ "$*" == *"ios:pods"* ]]; then exit 0; fi',
    'if [[ "$*" == *"ios.sim.release"* ]]; then output="$OROT_DETOX_RELEASE_DERIVED_DATA_PATH"; suffix="Release-iphonesimulator"',
    'elif [[ "$*" == *"ios.sim.debug.openai-provider"* ]]; then output="$OROT_OPENAI_PROVIDER_DERIVED_DATA_PATH"; suffix="Debug-iphonesimulator"',
    'else exit 97; fi',
    'mkdir -p "$output/Build/Products/$suffix/Orot.app"',
    'touch "$output/Build/Products/$suffix/Orot.app/Orot"',
  ].join('\n'), { mode: 0o755 });
  writeFileSync(fakeXcrun, [
    '#!/usr/bin/env bash',
    '[[ "$1 $2" == "lipo -archs" && -f "$3" ]] || exit 95',
    'printf \'%s\\n\' "$EXPECTED_HOST_ARCH"',
  ].join('\n'), { mode: 0o755 });
  const hostArch = spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout.trim();
  const result = spawnSync('bash', [builder, ...(profile === 'all' ? [] : [profile])], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [binDirectory, process.env.PATH].join(':'),
      BUILD_CALLS: callsPath,
      EXPECTED_HOST_ARCH: hostArch,
      OROT_DETOX_RELEASE_DERIVED_DATA_PATH: releaseDerivedData,
      OROT_OPENAI_PROVIDER_DERIVED_DATA_PATH: debugDerivedData,
    },
    maxBuffer: 2_000_000,
  });
  const calls = existsSync(callsPath) ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean) : [];
  rmSync(directory, { recursive: true, force: true });
  return { result, calls };
}

test('builds and verifies only the selected Release or OpenAI Debug app after one Pods install', () => {
  const release = runBuilder('release');
  assert.equal(release.result.status, 0, release.result.stderr + release.result.stdout);
  assert.equal(release.calls.length, 2);
  assert.match(release.calls[0], /ios:pods/);
  assert.match(release.calls[1], /ios\.sim\.release/);
  assert.doesNotMatch(release.calls.join('\n'), /openai-provider/);

  const debug = runBuilder('openai-provider');
  assert.equal(debug.result.status, 0, debug.result.stderr + debug.result.stdout);
  assert.equal(debug.calls.length, 2);
  assert.match(debug.calls[0], /ios:pods/);
  assert.match(debug.calls[1], /ios\.sim\.debug\.openai-provider/);
  assert.doesNotMatch(debug.calls.join('\n'), /ios\.sim\.release/);
});

test('keeps the local all-profile helper and builds both variants only when requested', () => {
  const all = runBuilder();
  assert.equal(all.result.status, 0, all.result.stderr + all.result.stdout);
  assert.equal(all.calls.length, 3);
  assert.match(all.calls[0], /ios:pods/);
  assert.match(all.calls[1], /ios\.sim\.release/);
  assert.match(all.calls[2], /ios\.sim\.debug\.openai-provider/);
});

test('rejects an unknown build profile before invoking package commands', () => {
  const result = runBuilder('typo');
  assert.notEqual(result.result.status, 0);
  assert.deepEqual(result.calls, []);
});
