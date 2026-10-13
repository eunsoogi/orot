import UIKit
import XCTest

@MainActor
enum FormUITestConditions {
    /// AX can mark a keyboard-covered control hittable. Require its measured frame inside the visible scroller before touching it.
    /// Noninteractive text callers must prove rendered visibility separately when opting out of hit testing.
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scrollID: String, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true) {
        let scroll = UITestConditions.element(app, scrollID)
        reveal(target, in: app, scroll: scroll, towardTop: towardTop, horizontalPosition: horizontalPosition, requireHittable: requireHittable)
    }

    /// Nested footer content has a smaller native ScrollView than its tagged outer container. Callers can supply that observed viewport without changing existing tagged-scroll callers.
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scroll: XCUIElement, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5, requireHittable: Bool = true) {
        XCTAssertTrue(UITestConditions.exists(scroll))
        // AX rounds origins and sizes separately. Allow only their observed numerical error (well below one physical pixel), while retaining viewport and keyboard containment.
        let coordinateTolerance: CGFloat = 0.0001
        // Observe the last scroll too; otherwise a control revealed by the final allowed gesture is reported missing.
        for attempt in 0 ... 16 {
            let keyboard = app.keyboards.firstMatch
            let bottom = keyboard.exists ? min(scroll.frame.maxY, keyboard.frame.minY) : scroll.frame.maxY
            if target.exists, !requireHittable || target.isHittable, !target.frame.isEmpty,
               target.frame.minY >= scroll.frame.minY - coordinateTolerance, target.frame.maxY <= bottom + coordinateTolerance
            {
                return
            }
            if attempt == 16 {
                break
            }
            // Large-text rows can fit the viewport yet be overshot by a fixed half-page drag.
            // Follow their observed overflow in either direction, and keep the gesture above an actual keyboard.
            let height = bottom - scroll.frame.minY
            guard height > 0 else {
                XCTFail("The form has no visible viewport above the keyboard")
                return
            }
            let above = target.exists && !target.frame.isEmpty ? target.frame.minY < scroll.frame.minY : towardTop
            let overflow = target.exists && !target.frame.isEmpty
                ? (above ? scroll.frame.minY - target.frame.minY : target.frame.maxY - bottom)
                : height * 0.45
            let distance = min(max(overflow + 8, 30), height * 0.45)
            let startY = scroll.frame.minY + height * (above ? 0.25 : 0.75)
            let origin = scroll.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: scroll.frame.width * horizontalPosition, dy: startY - scroll.frame.minY))
            let end = origin.withOffset(CGVector(dx: scroll.frame.width * horizontalPosition, dy: startY - scroll.frame.minY + (above ? distance : -distance)))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTFail("Control did not enter the measured form viewport: hittable=\(target.isHittable), target=\(target.frame), viewport=\(scroll.frame), topDelta=\(target.frame.minY - scroll.frame.minY), bottomDelta=\(target.frame.maxY - scroll.frame.maxY); \(target.debugDescription)")
    }

    static func replace(_ input: XCUIElement, with text: String, in app: XCUIApplication, scrollID: String) {
        reveal(input, in: app, scrollID: scrollID)
        input.tap()
        let current = input.value as? String ?? ""
        if !current.isEmpty, current != input.placeholderValue {
            input.press(forDuration: 1)
            let selectAll = editMenuItem(app, "Select All")
            selectAll.tap()
            input.typeText(XCUIKeyboardKey.delete.rawValue)
        }
        if !text.isEmpty {
            // One native paste event avoids controlled-input character loss and per-key XCTest idling on a cold hosted runner.
            // The runner uses a dedicated fixture Simulator. Readback of another app's pasteboard can require permission and stall;
            // write only this test's synthetic input, then clear it instead of inspecting or retaining prior clipboard data.
            defer { UIPasteboard.general.string = nil }
            UIPasteboard.general.string = text
            input.press(forDuration: 1)
            let paste = editMenuItem(app, "Paste")
            paste.tap()
            exactValue(input, equals: text)
        }
        exactValue(input, equals: text)
    }

    private static func editMenuItem(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let menuItem = app.menuItems[label]
        let button = app.buttons[label]
        // Accessibility XXXL pages commands and exposes wrapped commands as buttons. Both observations still invoke the actual native editor menu.
        for _ in 0 ..< 6 {
            let item = menuItem.exists ? menuItem : button
            if item.exists, item.isHittable {
                return item
            }
            let next = app.buttons["Next Page"]
            guard next.exists, next.isHittable else { break }
            next.tap()
        }
        let item = menuItem.exists ? menuItem : button
        XCTAssertTrue(UITestConditions.exists(item, timeout: 5), app.debugDescription)
        return item
    }

    private static func exactValue(_ input: XCUIElement, equals text: String) {
        let matches = {
            let value = input.value as? String ?? ""
            return value == text || (text.isEmpty && value == input.placeholderValue)
        }
        // Avoid the expectation's initial polling interval when the observed value already matches.
        if matches() {
            return
        }
        let exact = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in matches() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [exact], timeout: 30), .completed, input.debugDescription)
    }
}
