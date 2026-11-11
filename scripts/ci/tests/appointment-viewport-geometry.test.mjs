import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('appointment viewport rejects unsafe edges, clipped title and undersized hit targets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-appointment-viewport-'));
  try {
    const main = join(directory, 'main.swift');
    writeFileSync(
      main,
      `import Foundation
typealias G = AppointmentViewportGeometry
let window = CGRect(x: 0, y: 0, width: 466, height: 678)
let insets = G.Insets(top: 0, right: 84, bottom: 34, left: 0)
let scroll = CGRect(x: 0, y: 0, width: 382, height: 588)
let title = CGRect(x: 20, y: 20, width: 342, height: 24)
let toolbar = CGRect(x: 44, y: 596, width: 294, height: 48)
precondition(G.accepts(window: window, insets: insets, scroll: scroll, title: title, toolbar: toolbar))
precondition(!G.accepts(window: window, insets: .init(top: 44, right: 84, bottom: 34, left: 0), scroll: scroll, title: title, toolbar: toolbar))
precondition(!G.accepts(window: window, insets: insets, scroll: CGRect(x: 0, y: 0, width: 400, height: 588), title: title, toolbar: toolbar))
precondition(!G.accepts(window: window, insets: insets, scroll: scroll, title: CGRect(x: 20, y: 580, width: 342, height: 12), toolbar: toolbar))
precondition(!G.accepts(window: window, insets: insets, scroll: scroll, title: title, toolbar: toolbar.offsetBy(dx: 0, dy: -20)))
precondition(G.isUsableTarget(CGRect(x: 0, y: 0, width: 44, height: 44), hittable: true))
precondition(!G.isUsableTarget(CGRect(x: 0, y: 0, width: 43, height: 44), hittable: true))
precondition(!G.isUsableTarget(CGRect(x: 0, y: 0, width: 44, height: 43), hittable: true))
precondition(!G.isUsableTarget(CGRect(x: 0, y: 0, width: 44, height: 44), hittable: false))
`,
    );
    const executable = join(directory, 'geometry-test');
    execFileSync('swiftc', [
      'apps/mobile/ios/OrotUITests/AppointmentViewportGeometry.swift',
      main,
      '-o',
      executable,
    ]);
    assert.doesNotThrow(() => execFileSync(executable));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
