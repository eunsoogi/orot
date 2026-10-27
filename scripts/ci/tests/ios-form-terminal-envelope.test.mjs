import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('terminal scalars survive dispatch mutation and bounded collection loss', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-form-terminal-'));
  const window = readFileSync(
    'apps/mobile/ios/OrotMobile/HealthReviewObservationWindow.swift',
    'utf8',
  );
  const snapshot = readFileSync(
    'apps/mobile/ios/OrotMobile/HealthReviewFormSnapshot.swift',
    'utf8',
  );
  const fields = window
    .slice(window.indexOf('        enum Phase'), window.indexOf('        init(windowScene:'))
    .replace('private let launch: UUID', 'private let launch = UUID()')
    .replace('private let writer: Writer', 'private let writer = Sink()');
  const dispatch = window.slice(
    window.indexOf('        override func sendEvent'),
    window.indexOf('        @objc'),
  );
  const capture = window.slice(
    window.indexOf('        /// Copy terminal identity'),
    window.indexOf('        /// One serial background'),
  );
  // Actual traversal/prepare/finish execute against mutable host doubles, not UIKit. Keep temp products as evidence.
  writeFileSync(
    join(directory, 'Control.swift'),
    `import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif
@MainActor class UIView: NSObject {
 var subviews: [UIView] = []
 weak var superview: UIView?
 var accessibilityIdentifier: String?
 var isFirstResponder = false
 var bounds = CGRect(x: 0, y: 0, width: 10, height: 10)
 func add(_ child: UIView) { subviews.append(child); child.superview = self }
 func isDescendant(of view: UIView) -> Bool { self === view || superview?.isDescendant(of: view) == true }
 func convert(_ rect: CGRect, to: UIView) -> CGRect { rect }
}
struct UIEdgeInsets { var top = 0.0; var left = 0.0; var bottom = 0.0; var right = 0.0 }
@MainActor class UIScrollView: UIView {
 var contentOffset = CGPoint.zero
 var contentSize = CGSize.zero
 var contentInset = UIEdgeInsets()
 var adjustedContentInset = UIEdgeInsets()
 var isDragging = false
 var isDecelerating = false
}
@MainActor class UITextField: UIView {}
@MainActor class UITextView: UIView {}
@MainActor class Screen { let coordinateSpace = UIView() }
@MainActor class UIWindow: UIView {
 let screen = Screen()
 var dispatched: (() -> Void)?
 var dispatchCount = 0
 func sendEvent(_ event: UIEvent) { dispatchCount += 1; dispatched?() }
 func convert(_ point: CGPoint, to: UIView) -> CGPoint { point }
 override func convert(_ rect: CGRect, to: UIView) -> CGRect { rect }
}
@MainActor class UITouch: NSObject {
 enum Phase { case began, ended, cancelled, moved }
 var phase: Phase = .began
 var timestamp = 1.0
 var view: UIView?
 var point = CGPoint(x: 20, y: 50)
 func location(in: UIWindow) -> CGPoint { point }
}
@MainActor class UIEvent {
 enum Kind { case touches, other }
 var type = Kind.touches
 var allTouches: Set<UITouch>?
 init(_ touches: [UITouch]) { allTouches = Set(touches) }
}
${snapshot
  .replace('#if OROT_TESTS', '')
  .replace('    import UIKit', '')
  .replace(/#endif\s*$/, '')}
@MainActor final class Window: UIWindow {
${fields}
${dispatch}
${capture}
 final class Sink { var records: [Record] = []; func append(_ record: Record) { records.append(record) } }
 var records: [Record] { writer.records }
}
@main struct Control {
 @MainActor static func main() throws {
  func form(_ window: Window) -> UIView {
   let form = UIView(); form.accessibilityIdentifier = "health-review-screen"; window.add(form)
   let start = UIView(); start.accessibilityIdentifier = "health-review-start"; form.add(start)
   return start
  }
  let window = Window(); let receiver = form(window)
  let touch = UITouch(); touch.view = receiver
  let event = UIEvent([touch]); window.sendEvent(event)
  touch.phase = .ended; touch.timestamp = 2; touch.point = CGPoint(x: 20, y: 10)
  window.dispatched = { touch.phase = .moved; touch.timestamp = 99; touch.point = .zero; touch.view = nil; event.allTouches = [] }
  window.sendEvent(event)
  precondition(window.dispatchCount == 2 && window.records.count == 2)
  let terminal = window.records[1]
  precondition(terminal.phase == .ended && terminal.touch == window.records[0].touch)
  precondition(terminal.touchUptime == 2 && terminal.point == [20, 10])
  precondition(terminal.geometry == nil && terminal.losses == [.receiverMissing])
  // An arrived untracked terminal is visible; an absent event produces no invented terminal.
  let unknown = UITouch(); unknown.phase = .cancelled; unknown.view = receiver
  window.dispatched = nil; window.sendEvent(UIEvent([unknown]))
  precondition(window.records.last!.phase == .cancelled && window.records.last!.losses == [.trackingMissing])
  let count = window.records.count; window.sendEvent(UIEvent([])); precondition(window.records.count == count)
  let overflow = Window(); let target = form(overflow); var touches: [UITouch] = []
  for _ in 0..<33 { let finger = UITouch(); finger.view = target; touches.append(finger); overflow.sendEvent(UIEvent([finger])) }
  precondition(overflow.records.last!.trackingDiscarded == 32 && overflow.records.last!.losses == [.trackingOverflow])
  touches[0].phase = .ended; overflow.sendEvent(UIEvent([touches[0]]))
  precondition(overflow.records.last!.losses == [.trackingMissing])
  let missing = Window()
  precondition(HealthReviewFormSnapshot.capture(in: missing, receiver: nil).loss == .formMissing)
  let first = form(missing); _ = form(missing)
  precondition(HealthReviewFormSnapshot.capture(in: missing, receiver: first).loss == .formAmbiguous)
  let valid = Window(); let control = form(valid)
  precondition(HealthReviewFormSnapshot.capture(in: valid, receiver: nil).loss == .receiverMissing)
  precondition(HealthReviewFormSnapshot.capture(in: valid, receiver: UIView()).loss == .receiverOutsideForm)
  control.isFirstResponder = true
  let another = UIView(); another.isFirstResponder = true; control.superview!.add(another)
  let focus = HealthReviewFormSnapshot.capture(in: valid, receiver: control)
  precondition(focus.loss == nil && focus.geometry?.focusMatches == 2 && focus.geometry?.focusedInput == nil)
  for _ in 0..<513 { valid.add(UIView()) }
  precondition(HealthReviewFormSnapshot.capture(in: valid, receiver: control).loss == .traversalLimit)
  let changed = Window(); let old = form(changed); let newer = UITextField(); old.superview!.add(newer)
  let finger = UITouch(); finger.view = old; changed.sendEvent(UIEvent([finger])); finger.phase = .ended
  changed.dispatched = { finger.view = newer; finger.phase = .began }
  changed.sendEvent(UIEvent([finger]))
  precondition(changed.records.last!.geometry?.receiver?.role == .textInput && changed.records.last!.phase == .ended)
  print(String(decoding: try JSONEncoder().encode(window.records), as: UTF8.self))
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
      join(directory, 'Control.swift'),
      '-o',
      binary,
    ],
    { timeout: 60000 },
  );
  const records = JSON.parse(execFileSync(binary, [], { encoding: 'utf8', timeout: 10000 }));
  assert.deepEqual(records[1].losses, ['receiverMissing']);
  assert.equal(records[1].geometry, undefined);
  assert.equal(records[1].touchUptime, 2);
  assert.deepEqual(Object.keys(records[1]).sort(), [
    'capturedUptime',
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
});
