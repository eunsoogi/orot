import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Captured-frame logic cannot prove native accessibility or actual hit testing.
test('literature reveal respects the measured dock and window', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-literature-reveal-'));
  try {
    const main = join(directory, 'main.swift');
    writeFileSync(
      main,
      `import Foundation
let window = CGRect(x: 10, y: 20, width: 400, height: 800)
let scroll = CGRect(x: 10, y: 60, width: 400, height: 720)
let dock = CGRect(x: 20, y: 700, width: 380, height: 60)
func decision(_ target: CGRect) -> LiteratureActionGeometry.Decision? {
  LiteratureActionGeometry.decide(window: window, scroll: scroll, dock: dock, target: target)
}
precondition(decision(CGRect(x: 30, y: 640, width: 200, height: 44)) == .visible)
precondition(decision(CGRect(x: 30, y: 641, width: 200, height: 44)) == .up)
precondition(decision(CGRect(x: 30, y: 30, width: 200, height: 44)) == .down)
precondition(decision(CGRect(x: 0, y: 200, width: 420, height: 44)) == nil)
precondition(LiteratureActionGeometry.decide(window: .zero, scroll: scroll, dock: dock, target: scroll) == nil)
precondition(LiteratureActionGeometry.decide(window: window, scroll: scroll, dock: .zero, target: scroll) == nil)
`,
    );
    const executable = join(directory, 'geometry');
    execFileSync('swiftc', [
      'apps/mobile/ios/OrotUITests/LiteratureActionGeometry.swift',
      main,
      '-o',
      executable,
    ]);
    execFileSync(executable);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const source = readFileSync(
    'apps/mobile/ios/OrotUITests/SummaryAndLiteratureUITests.swift',
    'utf8',
  );
  assert.match(source, /LiteratureActionReveal\.reveal\(open, in: app, dock: search\)/);
  assert.doesNotMatch(source, /scrollToBottom\(app, "external-medical-evidence-screen"\)/);
  for (const assertion of [
    'search.frame.minY - 16',
    'open.isHittable',
    'open.frame.height, 44',
    'synthetic-article-opened',
    'inference-disclosure-cancel',
    'literature-recovered-',
    'literature-cancelled-',
  ]) {
    assert.ok(source.includes(assertion), assertion);
  }
});
