import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('runner observations preserve operations, bind stalled steps and exclude private errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-form-scroll-'));
  try {
    const native = readFileSync(
      'apps/mobile/ios/OrotMobile/HealthReviewFormSnapshot.swift',
      'utf8',
    );
    const dispatch = native.slice(
      native.indexOf('    enum FormObservationDispatch'),
      native.indexOf('    /// Only fixed roles'),
    );
    writeFileSync(join(directory, 'Dispatch.swift'), `import Foundation\n${dispatch}`);
    writeFileSync(
      join(directory, 'main.swift'),
      `#if canImport(CoreGraphics)
import CoreGraphics
#endif
import Foundation
let launch = UUID()
let frame = CGRect(x: 12, y: 574, width: 300, height: 48)
let start = CGPoint(x: 201, y: 450)
let end = CGPoint(x: 201, y: 410)
let sentinel = NSError(domain: "private-health-input", code: 1)
var steps: [Int] = []
var records: [FormScrollObservation.Record] = []
func drag(_ observer: FormScrollObservation?, step: Int, fails: Bool = false) throws {
  try FormScrollObservation.around(observer, step: step, target: frame, start: start, end: end) {
    steps.append(step)
    if fails { throw sentinel }
  }
}
try drag(nil, step: 1)
let throwing = FormScrollObservation(launch: launch, reveal: 3) { _ in throw sentinel }
try drag(throwing, step: 2)
do { try drag(throwing, step: 3, fails: true); fatalError("Original failure lost") }
catch { precondition(error as NSError === sentinel) }
precondition(steps == [1, 2, 3])
let observer = FormScrollObservation(launch: launch, reveal: 4) { records.append($0) }
observer.observed(frame, completedSteps: 0)
try drag(observer, step: 1)
observer.observed(frame.offsetBy(dx: 0, dy: -151), completedSteps: 1)
try drag(observer, step: 2)
observer.observed(frame, completedSteps: 2)
FormScrollObservation.around(observer, step: 3, target: frame, start: start, end: end) { steps.append(4) }
observer.observed(nil, completedSteps: 3)
try drag(observer, step: 4)
observer.observed(frame, completedSteps: 4)
try drag(observer, step: 5)
observer.observed(frame, completedSteps: 5)
let stalls = records.filter { $0.phase == .firstStall }
precondition(stalls.count == 1 && stalls[0].step == 2)
precondition(records.allSatisfy { $0.launch == launch && $0.reveal == 4 })
let pairs = records.filter { [.before, .after].contains($0.phase) }
precondition(pairs.map(\\.step) == [1,1,2,2,3,3,4,4,5,5])
precondition(pairs.allSatisfy { $0.start == [201,450] && $0.end == [201,410] })
precondition(zip(records, records.dropFirst()).allSatisfy { $0.uptime <= $1.uptime })
let json = String(decoding: try JSONEncoder().encode(records), as: UTF8.self)
precondition(!json.contains("private-health-input"))
var dispatches = 0
var order: [String] = []
let delivered = FormObservationDispatch.around(before: nil, after: nil) { dispatches += 1; return 47 }
precondition(delivered == 47 && dispatches == 1)
do {
  try FormObservationDispatch.around(before: { order.append("before"); throw sentinel }, after: { order.append("after"); throw sentinel }) {
    order.append("dispatch"); dispatches += 1; throw sentinel
  }
  fatalError("Original dispatch failure lost")
} catch { precondition(error as NSError === sentinel) }
precondition(dispatches == 2 && order == ["before", "dispatch", "after"])
let before = FormScrollObservation.Record(launch: launch, reveal: 4, step: 2, phase: .before, uptime: 100, target: nil, start: [201,450], end: [201,410])
let after = FormScrollObservation.Record(launch: launch, reveal: 4, step: 2, phase: .after, uptime: 110, target: nil, start: [201,450], end: [201,410])
func touch(_ phase: String, number: Int = 1, session: UUID = launch, count: Int = 1, x: Double = 201, time: Double? = nil, truncated: Bool = false) throws -> FormScrollObservation.Touch {
  let began = phase == "began"
  let stamp = time ?? (began ? 101.0 : 108.0)
  let value: [String: Any] = ["launch": session.uuidString, "sequence": began ? 1 : 2, "touch": number, "phase": phase,
    "touchUptime": stamp, "capturedUptime": stamp + 0.1, "point": [x, began ? 450.0 : 410.0], "touchCount": count,
    "geometry": ["truncated": truncated, "startMatches": 1]]
  return try JSONDecoder().decode(FormScrollObservation.Touch.self, from: JSONSerialization.data(withJSONObject: value))
}
let pair = try [touch("began"), touch("ended")]
precondition(FormScrollObservation.bind(pair, dropped: 0, before: before, after: after) == 1)
let invalidPairs = try [[], [touch("began")], [touch("began"), touch("cancelled")],
  [touch("began", session: UUID()), touch("ended")], [touch("began", count: 2), touch("ended")],
  [touch("began", x: 205), touch("ended")], [touch("began", time: 99), touch("ended")],
  [touch("began"), touch("ended", time: 111)], [touch("began", truncated: true), touch("ended")],
  pair + [touch("began", number: 2), touch("ended", number: 2)]]
for invalid in invalidPairs { precondition(FormScrollObservation.bind(invalid, dropped: 0, before: before, after: after) == nil) }
precondition(FormScrollObservation.bind(pair, dropped: 1, before: before, after: after) == nil)
let wrongStep = FormScrollObservation.Record(launch: launch, reveal: 4, step: 3, phase: .after, uptime: 110, target: nil, start: [201,450], end: [201,410])
precondition(FormScrollObservation.bind(pair, dropped: 0, before: before, after: wrongStep) == nil)
print("source-controls-pass")
`,
    );
    const binary = join(directory, 'control');
    execFileSync(
      'swiftc',
      [
        '-warnings-as-errors',
        'apps/mobile/ios/OrotUITests/FormScrollObservation.swift',
        join(directory, 'Dispatch.swift'),
        join(directory, 'main.swift'),
        '-o',
        binary,
      ],
      { timeout: 60000 },
    );
    const output = execFileSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.match(output, /source-controls-pass/);
    assert.equal(output.includes('private-health-input'), false);
    const form = readFileSync('apps/mobile/ios/OrotUITests/FormUITestConditions.swift', 'utf8');
    assert.equal(
      form.match(
        /start\.press\(forDuration: 0\.05, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0\)/g,
      )?.length,
      1,
    );
    assert.match(form, /for attempt in 0 \.\.\. 16/);
    assert.match(form, /XCTFail\("Control did not enter the measured form viewport:/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
