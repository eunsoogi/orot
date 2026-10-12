import XCTest

@MainActor
enum FormUITestConditions {
    /// AX can mark a keyboard-covered control hittable. Require its measured frame inside the visible scroller before touching it.
    static func reveal(_ target: XCUIElement, in app: XCUIApplication, scrollID: String, towardTop: Bool = false) {
        let scroll = UITestConditions.element(app, scrollID)
        XCTAssertTrue(scroll.waitForExistence(timeout: 30))
        for _ in 0 ..< 16 {
            let keyboard = app.keyboards.firstMatch
            let bottom = keyboard.exists ? min(scroll.frame.maxY, keyboard.frame.minY) : scroll.frame.maxY
            if target.exists, target.isHittable, !target.frame.isEmpty,
               target.frame.minY >= scroll.frame.minY, target.frame.maxY <= bottom
            {
                return
            }
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: towardTop ? 0.2 : 0.65))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: towardTop ? 0.65 : 0.2))
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
            XCTAssertTrue(selectAll.waitForExistence(timeout: 5), app.debugDescription)
            selectAll.tap()
            input.typeText(XCUIKeyboardKey.delete.rawValue)
        }
        // A fast synthetic string lost characters in the controlled React input. Observe each real key before the next event.
        var entered = ""
        for character in text {
            entered.append(character)
            input.typeText(String(character))
            exactValue(input, equals: entered)
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
