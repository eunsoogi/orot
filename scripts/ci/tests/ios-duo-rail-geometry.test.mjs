import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('the native rail oracle rejects content outside the measured UIKit lane', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-duo-rail-'));
  try {
    const main = join(directory, 'main.swift');
    // Compile the actual comparison used by XCTest against the observed window and deliberate mismatches.
    writeFileSync(
      main,
      `import Foundation
typealias M = NavigationGeometryReservedRegionMatcher
let window = M.GeometryRect(x: 0, y: 0, width: 466, height: 678)
let insets = M.GeometryInsets(top: 0, right: 84, bottom: 34, left: 0)
let lane = M.GeometryRect(x: 0, y: 0, width: 382, height: 644)
let wrongLane = M.GeometryRect(x: 0, y: 0, width: 390, height: 644)
let bar = M.GeometryRect(x: 394.1667, y: 299, width: 48, height: 276)
let wrongBar = M.GeometryRect(x: 392, y: 299, width: 48, height: 276)
func check(_ viewport: M.GeometryRect, _ available: M.GeometryRect, _ usable: [M.GeometryRect], _ actualBar: M.GeometryRect, _ side: String) -> Bool {
  M.rightRailMatches(window: window, insets: insets, usable: usable, viewport: viewport,
                     available: available, bar: actualBar, navigation: bar, side: side)
}
precondition(check(lane, lane, [lane], bar, "right"))
precondition(!check(wrongLane, wrongLane, [lane], bar, "right"))
precondition(!check(lane, wrongLane, [lane], bar, "right"))
precondition(!check(lane, lane, [wrongLane], bar, "right"))
precondition(!check(lane, lane, [lane], wrongBar, "right"))
precondition(!check(lane, lane, [lane], bar, "bottom"))
`,
    );
    const executable = join(directory, 'rail-test');
    execFileSync('swiftc', [
      'apps/mobile/ios/OrotUITests/NavigationGeometryReservedRegionMatcher.swift',
      main,
      '-o',
      executable,
    ]);
    assert.doesNotThrow(() => execFileSync(executable));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
