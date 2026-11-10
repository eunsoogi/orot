import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('current route observation rejects unrelated or stale samples', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-route-observation-'));
  try {
    const executable = join(directory, 'check');
    execFileSync('swiftc', [
      'apps/mobile/ios/OrotUITests/NavigationCurrentRouteObservation.swift',
      'scripts/ci/tests/fixtures/ios-navigation-current-route-control.swift',
      '-o',
      executable,
    ]);
    execFileSync(executable);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
