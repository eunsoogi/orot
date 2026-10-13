import UIKit
import XCTest

@MainActor
enum FormUITestConditions {
    /// AX can mark a keyboard-covered control hittable. Require its measured frame inside the visible scroller before touching it.
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scrollID: String, towardTop: Bool = false, horizontalPosition: CGFloat = 0.5) {
        let scroll = UITestConditions.element(app, scrollID)
        XCTAssertTrue(UITestConditions.exists(scroll))
        // Observe the last scroll too; otherwise a control revealed by the final allowed gesture is reported missing.
        for attempt in 0 ... 16 {
            let keyboard = app.keyboards.firstMatch
            let bottom = keyboard.exists ? min(scroll.frame.maxY, keyboard.frame.minY) : scroll.frame.maxY
            if target.exists, target.isHittable, !target.frame.isEmpty,
               target.frame.minY >= scroll.frame.minY, target.frame.maxY <= bottom
            {
                return
            }
            if attempt == 16 {
                break
            }
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: horizontalPosition, dy: towardTop ? 0.2 : 0.65))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: horizontalPosition, dy: towardTop ? 0.65 : 0.2))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTFail("Control did not enter the measured form viewport: \(target.debugDescription)")
    }

    static func replace(_ input: XCUIElement, with text: String, in app: XCUIApplication, scrollID: String) {
        reveal(input, in: app, scrollID: scrollID)
        input.tap()
        let current = input.value as? String ?? ""
        if !current.isEmpty, current != input.placeholderValue {
            input.press(forDuration: 1)
            let selectAll = app.menuItems["Select All"]
            XCTAssertTrue(UITestConditions.exists(selectAll, timeout: 5), app.debugDescription)
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
            let paste = app.menuItems["Paste"]
            XCTAssertTrue(UITestConditions.exists(paste, timeout: 5), app.debugDescription)
            paste.tap()
            exactValue(input, equals: text)
        }
        exactValue(input, equals: text)
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
