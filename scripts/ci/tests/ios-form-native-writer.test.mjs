import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('native scalar writer bounds storage and compiles its cross-actor record boundary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-form-writer-'));
  try {
    const snapshot = readFileSync(
      'apps/mobile/ios/OrotMobile/HealthReviewFormSnapshot.swift',
      'utf8',
    );
    const window = readFileSync(
      'apps/mobile/ios/OrotMobile/HealthReviewObservationWindow.swift',
      'utf8',
    );
    const overlap = window.slice(
      window.indexOf('            if touches.count > 1'),
      window.indexOf(
        '            var terminals:',
        window.indexOf('            if touches.count > 1'),
      ),
    );
    const scalars = snapshot.slice(
      snapshot.indexOf('    struct HealthReviewFormSnapshot'),
      snapshot.indexOf('        /// Traverse'),
    );
    const session = window.slice(
      window.indexOf('        static func session'),
      window.indexOf('        override func sendEvent'),
    );
    const records = window.slice(
      window.indexOf('        enum Phase'),
      window.indexOf('        /// Only this synchronous'),
    );
    let writer = window.slice(
      window.indexOf('        private final class Writer'),
      window.lastIndexOf('    }'),
    );
    // Host overlays expose only drain/access and a disposable destination. The serial writer/encoder execute unchanged.
    writer = writer
      .replace('private final class Writer', 'final class Writer')
      .replace('func append(', 'func drain() { queue.sync {} }\n            func append(');
    writer = writer.replace(
      /url = FileManager\.default\.urls[\s\S]*?\.appendingPathComponent\([^\n]+\)/,
      `url = URL(fileURLWithPath: ProcessInfo.processInfo.environment["WRITER_DESTINATION"] ?? ${JSON.stringify(join(directory, 'record.json'))})`,
    );
    assert.ok(writer.includes('url = URL('));
    writeFileSync(
      join(directory, 'Writer.swift'),
      `import Foundation\n${scalars}\n}\n@MainActor enum Window {\n${records}\n${session}\n${writer}\n}`,
    );
    writeFileSync(
      join(directory, 'main.swift'),
      `import Foundation
@main struct Control {
  @MainActor static func main() {
    var active: [ObjectIdentifier: (number: Int, multiple: Bool)] = [:]
    let identity = ObjectIdentifier(NSObject.self)
    active[identity] = (1, false)
    func mark(_ count: Int) {
      let touches = Array(repeating: 0, count: count)
${overlap}
    }
    mark(1)
    precondition(active[identity]?.multiple == false)
    mark(2)
    mark(1)
    precondition(active[identity]?.multiple == true)
    let launch = UUID()
    let suite = "form-observer-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    precondition(Window.session(defaults: defaults) == nil)
    defaults.set("invalid-private-value", forKey: "OROT_TEST_FORM_OBSERVATION")
    precondition(Window.session(defaults: defaults) == nil)
    defaults.set(launch.uuidString, forKey: "OROT_TEST_FORM_OBSERVATION")
    precondition(Window.session(defaults: defaults) == launch)
    let writer = Window.Writer(launch: launch)
    let geometry = HealthReviewFormSnapshot(start: .init(role: .control, frame: [1,2,3,4]), focusedInput: nil,
      receiver: .init(role: .textInput, frame: [5,6,7,8]), scrolls: [], truncated: false, startMatches: 1, focusMatches: 0)
    for sequence in 1...130 {
      writer.append(Window.Record(launch: launch, sequence: sequence, touch: sequence, phase: .began,
        touchUptime: 1, capturedUptime: 2, point: [3,4], touchCount: 1, multipleTouches: false, geometry: geometry,
        keyboardInScreen: nil, keyboardObservedUptime: nil))
    }
    writer.drain()
  }
}`,
    );
    const binary = join(directory, 'control');
    execFileSync(
      'swiftc',
      [
        '-swift-version',
        '6',
        '-warnings-as-errors',
        '-parse-as-library',
        join(directory, 'Writer.swift'),
        join(directory, 'main.swift'),
        '-o',
        binary,
      ],
      { timeout: 60000 },
    );
    execFileSync(binary, [], { timeout: 10000 });
    const failed = execFileSync(binary, [], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        WRITER_DESTINATION: join(directory, 'private-health-path', 'missing.json'),
      },
    });
    assert.match(failed, /OROT_FORM_NATIVE_UNKNOWN/);
    assert.equal(failed.includes('private-health-path'), false);
    const payload = JSON.parse(readFileSync(join(directory, 'record.json'), 'utf8'));
    assert.equal(payload.captured, 130);
    assert.equal(payload.dropped, 2);
    assert.equal(payload.records.length, 128);
    assert.equal(payload.records[0].sequence, 3);
    assert.equal(payload.records.at(-1).sequence, 130);
    assert.deepEqual(Object.keys(payload.records[0]).sort(), [
      'capturedUptime',
      'geometry',
      'launch',
      'losses',
      'multipleTouches',
      'phase',
      'point',
      'sequence',
      'touch',
      'touchCount',
      'touchUptime',
      'trackingDiscarded',
    ]);
    assert.deepEqual(Object.keys(payload.records[0].geometry).sort(), [
      'focusMatches',
      'receiver',
      'scrolls',
      'start',
      'startMatches',
      'truncated',
    ]);
    assert.deepEqual(payload.records[0].geometry.receiver, {
      role: 'textInput',
      frame: [5, 6, 7, 8],
    });
    const delegate = readFileSync('apps/mobile/ios/OrotMobile/AppDelegate.swift', 'utf8');
    assert.match(
      delegate,
      /#if OROT_TESTS\s+if let launch = HealthReviewObservationWindow.session\(\)/,
    );
    assert.match(
      delegate,
      /else \{\s+window = UIWindow\(windowScene: windowScene\)\s+\}\s+#else\s+window = UIWindow\(windowScene: windowScene\)/,
    );
    assert.equal(window.match(/super\.sendEvent\(event\)/g)?.length, 1);
    assert.equal(
      /\.hitTest\(|addGestureRecognizer|setContentOffset|becomeFirstResponder|layoutIfNeeded/.test(
        window + snapshot,
      ),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
