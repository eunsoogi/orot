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
let openWindow = CGRect(x: 0, y: 0, width: 951, height: 669)
let applicationEnvelope = CGRect(x: 0, y: 0, width: 669, height: 951)
precondition(applicationEnvelope != openWindow)
precondition(G.matchesOwningWindow(openWindow, screen: openWindow, nativeBounds: openWindow))
precondition(!G.matchesOwningWindow(openWindow, screen: openWindow.offsetBy(dx: 1, dy: 0), nativeBounds: openWindow))
precondition(!G.matchesOwningWindow(openWindow, screen: openWindow, nativeBounds: applicationEnvelope))
let openInsets = G.Insets(top: 0, right: 84, bottom: 34, left: 0)
let openScroll = CGRect(x: 0, y: 0, width: 867, height: 579)
let openTitle = CGRect(x: 20, y: 20, width: 827, height: 24)
let openToolbar = CGRect(x: 44, y: 587, width: 779, height: 48)
precondition(G.accepts(window: openWindow, insets: openInsets, scroll: openScroll, title: openTitle, toolbar: openToolbar, minimumTitleHeight: 20))
precondition(!G.accepts(window: openWindow, insets: openInsets, scroll: CGRect(x: 0, y: 0, width: 868, height: 579), title: openTitle, toolbar: openToolbar, minimumTitleHeight: 20))
precondition(!G.accepts(window: openWindow, insets: openInsets, scroll: openScroll, title: openTitle, toolbar: openToolbar.offsetBy(dx: 0, dy: 1), minimumTitleHeight: 20))
precondition(!G.accepts(window: openWindow, insets: openInsets, scroll: openScroll, title: openTitle, toolbar: openToolbar.offsetBy(dx: 0, dy: -10), minimumTitleHeight: 20))
let window = CGRect(x: 0, y: 0, width: 466, height: 678)
let insets = G.Insets(top: 0, right: 84, bottom: 34, left: 0)
let scroll = CGRect(x: 0, y: 0, width: 382, height: 588)
let title = CGRect(x: 20, y: 20, width: 342, height: 24)
let toolbar = CGRect(x: 44, y: 596, width: 294, height: 48)
precondition(G.accepts(window: window, insets: insets, scroll: scroll, title: title, toolbar: toolbar, minimumTitleHeight: 20))
precondition(!G.accepts(window: window, insets: .init(top: 44, right: 84, bottom: 34, left: 0), scroll: scroll, title: title, toolbar: toolbar, minimumTitleHeight: 20))
precondition(!G.accepts(window: window, insets: insets, scroll: CGRect(x: 0, y: 0, width: 400, height: 588), title: title, toolbar: toolbar, minimumTitleHeight: 20))
precondition(!G.accepts(window: window, insets: insets, scroll: scroll, title: CGRect(x: 20, y: 570, width: 342, height: 24), toolbar: toolbar, minimumTitleHeight: 20))
precondition(!G.accepts(window: window, insets: insets, scroll: scroll, title: title, toolbar: toolbar.offsetBy(dx: 0, dy: -20), minimumTitleHeight: 20))
precondition(!G.accepts(window: window, insets: insets, scroll: scroll, title: CGRect(x: 20, y: 20, width: 342, height: 1), toolbar: toolbar, minimumTitleHeight: 20))
precondition(!G.accepts(window: window, insets: insets, scroll: scroll, title: CGRect(x: 20, y: 20, width: 342, height: 19), toolbar: toolbar, minimumTitleHeight: 20))
precondition(G.accepts(window: window, insets: insets, scroll: scroll, title: CGRect(x: 20, y: 20, width: 342, height: 60), toolbar: toolbar, minimumTitleHeight: 58))
precondition(!G.accepts(window: window, insets: insets, scroll: scroll, title: title, toolbar: toolbar, minimumTitleHeight: 58))
precondition(G.isUsableTarget(CGRect(x: 0, y: 0, width: 44, height: 44), hittable: true))
precondition(!G.isUsableTarget(CGRect(x: 0, y: 0, width: 43, height: 44), hittable: true))
precondition(!G.isUsableTarget(CGRect(x: 0, y: 0, width: 44, height: 43), hittable: true))
precondition(!G.isUsableTarget(CGRect(x: 0, y: 0, width: 44, height: 44), hittable: false))
func samples(_ first: Double, _ second: Double, _ windowID: String) -> Bool {
  G.samplesBracketAX(launch: 10, axStart: 20, firstStart: first, firstEnd: first + 1,
                     secondStart: second, secondEnd: second + 1, firstWindow: "window-a", secondWindow: windowID)
}
precondition(samples(15, 21, "window-a"))
precondition(!samples(5, 21, "window-a"))
precondition(!samples(15, 15, "window-a"))
precondition(!samples(15, 21, "window-b"))
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
