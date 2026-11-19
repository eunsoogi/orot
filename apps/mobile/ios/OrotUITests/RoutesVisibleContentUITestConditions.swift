import XCTest

/// Route-specific observations preserve the floating composer's and long report's real native geometry.
@MainActor
enum RoutesVisibleContentUITestConditions {
    static func composer(_ control: XCUIElement, in app: XCUIApplication) throws {
        let dock = UITestConditions.element(app, "rag-conversation-composer")
        let history = UITestConditions.element(app, "rag-conversation-history")
        XCTAssertTrue(UITestConditions.exists(control))
        XCTAssertTrue(UITestConditions.exists(dock))
        XCTAssertTrue(UITestConditions.exists(history))
        XCTAssertTrue(control.isHittable, control.debugDescription)
        XCTAssertTrue(dock.frame.contains(control.frame), "Control: \(control.frame), dock: \(dock.frame)")
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            XCTAssertLessThanOrEqual(control.frame.maxY, keyboard.frame.minY + 1)
        }
        let back = UITestConditions.element(app, "navigation-back")
        if back.exists {
            XCTAssertFalse(control.frame.intersects(back.frame))
        }
    }

    /// The transcript extends behind the dock; its actual final failure must scroll into view above it.
    static func lastMessage(_ message: XCUIElement, in app: XCUIApplication) throws {
        let history = UITestConditions.element(app, "rag-conversation-history")
        let dock = UITestConditions.element(app, "rag-conversation-composer")
        XCTAssertTrue(UITestConditions.exists(history) && UITestConditions.exists(dock))
        XCTAssertTrue(UITestConditions.exists(message))
        history.swipeUp()
        XCTAssertTrue(message.isHittable, message.debugDescription)
        let visible = history.frame.intersection(app.frame)
        XCTAssertTrue(visible.contains(message.frame), "Message: \(message.frame), history: \(visible)")
        XCTAssertLessThanOrEqual(message.frame.maxY, dock.frame.minY + 1)
    }

    /// Cover the full AX text frame with overlapping visible intervals; an oversized paragraph cannot fit at once.
    static func prose(_ text: XCUIElement, expected: String, in app: XCUIApplication) throws {
        let scroll = UITestConditions.element(app, "navigation-route-scroll")
        XCTAssertTrue(UITestConditions.exists(scroll))
        XCTAssertTrue(UITestConditions.exists(text))
        let label = text.label
        XCTAssertTrue(label.contains(expected))
        let initialSize = text.frame.size
        guard let window = FormWindowOwnership.resolve(app, scroll: scroll, target: text) else {
            throw ObservationFailure.missingWindow
        }
        func viewport() -> CGRect {
            var visible = FormUITestConditions.unobstructedScrollFrame(scroll.frame.intersection(window.frame), target: text.frame, in: app)
            let keyboard = app.keyboards.firstMatch
            if keyboard.exists, keyboard.frame.intersects(visible) {
                visible.size.height = max(0, keyboard.frame.minY - visible.minY)
            }
            return visible
        }
        if text.frame.height <= viewport().height {
            _ = try XCTUnwrap(FormUITestConditions.reveal(text, in: app, scroll: scroll))
            XCTAssertTrue(text.isHittable)
            XCTAssertTrue(viewport().contains(text.frame), "Text: \(text.frame), viewport: \(viewport())")
            return
        }
        func drag(up: Bool, within visible: CGRect) {
            let origin = window.coordinate(withNormalizedOffset: .zero)
            let x = visible.midX - window.frame.minX
            let y1 = visible.minY + visible.height * (up ? 0.75 : 0.35) - window.frame.minY
            let y2 = visible.minY + visible.height * (up ? 0.35 : 0.75) - window.frame.minY
            origin.withOffset(CGVector(dx: x, dy: y1)).press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: x, dy: y2)))
        }
        // The first observation may start above or below the text; expose its top before measuring coverage.
        for _ in 0 ..< 16 {
            let frame = text.frame
            let visible = viewport()
            if frame.minY >= visible.minY, frame.minY < visible.maxY {
                break
            }
            drag(up: frame.minY >= visible.maxY, within: visible)
        }
        var covered: CGFloat = 0
        for _ in 0 ..< 20 {
            let frame = text.frame
            let visible = viewport()
            XCTAssertEqual(text.label, label)
            XCTAssertEqual(frame.width, initialSize.width, accuracy: 0.5)
            XCTAssertEqual(frame.height, initialSize.height, accuracy: 0.5)
            XCTAssertGreaterThanOrEqual(frame.minX, visible.minX - 0.5)
            XCTAssertLessThanOrEqual(frame.maxX, visible.maxX + 0.5)
            let start = max(0, visible.minY - frame.minY)
            let end = min(frame.height, visible.maxY - frame.minY)
            guard let next = RoutesVisibleInterval.advance(covered: covered, start: start, end: end, height: frame.height) else {
                XCTFail("Report text visibility has a gap or made no progress: covered=\(covered), frame=\(frame), viewport=\(visible)")
                throw ObservationFailure.incompleteText
            }
            XCTAssertTrue(text.isHittable, text.debugDescription)
            covered = next
            if covered >= frame.height - 1 {
                return
            }
            // Drag only within the measured, unobstructed viewport and reobserve after each gesture.
            drag(up: true, within: visible)
        }
        XCTFail("Report text did not reach its final visible interval: covered=\(covered)")
        throw ObservationFailure.incompleteText
    }

    private enum ObservationFailure: Error { case missingWindow, incompleteText }
}
