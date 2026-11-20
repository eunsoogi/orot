import XCTest

/// The Records journey checks actual saved prose in its owning native viewport.
@MainActor
enum RoutesVisibleContentUITestConditions {
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
        func drag(up: Bool, within visible: CGRect, distance: CGFloat? = nil) {
            let origin = window.coordinate(withNormalizedOffset: .zero)
            let x = visible.midX - window.frame.minX
            let delta = distance ?? visible.height * 0.4
            let y1 = visible.midY + (up ? delta / 2 : -delta / 2) - window.frame.minY
            let y2 = visible.midY + (up ? -delta / 2 : delta / 2) - window.frame.minY
            origin.withOffset(CGVector(dx: x, dy: y1)).press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: x, dy: y2)), withVelocity: .slow, thenHoldForDuration: 0)
        }
        if text.frame.height <= viewport().height {
            // The shared reveal frame does not include the route's floating navigation overlay.
            for attempt in 0 ... 16 {
                let frame = text.frame
                let visible = viewport()
                if visible.contains(frame) {
                    XCTAssertTrue(text.isHittable, text.debugDescription)
                    return
                }
                if attempt == 16 {
                    break
                }
                let up = frame.maxY > visible.maxY
                let overflow = up ? frame.maxY - visible.maxY : visible.minY - frame.minY
                let distance = RoutesVisibleInterval.revealDistance(overflow: overflow, slack: visible.height - frame.height, viewportHeight: visible.height)
                drag(up: up, within: visible, distance: distance)
            }
            XCTFail("Report text did not enter its unobstructed viewport: text=\(text.frame), viewport=\(viewport())")
            throw ObservationFailure.incompleteText
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

    /// This root route intentionally floats the composer over the padded ScrollView.
    private static func conversationBounds(_ app: XCUIApplication) throws -> (dock: CGRect, overlay: CGRect, viewport: CGRect, keyboard: CGRect?) {
        let history = UITestConditions.element(app, "rag-conversation-history")
        let composer = UITestConditions.element(app, "rag-conversation-composer")
        let floating = UITestConditions.element(app, "conversation-floating-composer-overlay")
        guard UITestConditions.exists(history), UITestConditions.exists(composer),
              UITestConditions.exists(floating),
              let window = FormWindowOwnership.resolve(app, scroll: history, target: floating),
              app.descendants(matching: .any).matching(identifier: composer.identifier).count == 1,
              window.descendants(matching: .any).matching(identifier: composer.identifier).count == 1
        else { throw ObservationFailure.missingWindow }
        let windowFrame = window.frame
        let historyFrame = history.frame
        let overlay = floating.frame
        let dock = composer.frame
        let keyboard = app.keyboards.firstMatch
        let keyboardFrame = keyboard.exists ? keyboard.frame : nil
        guard [historyFrame, overlay, dock].allSatisfy(FormScrollGeometry.valid),
              keyboardFrame.map(FormScrollGeometry.valid) ?? true,
              windowFrame.insetBy(dx: -1, dy: -1).contains(overlay),
              overlay.insetBy(dx: -1, dy: -1).contains(dock)
        else { throw ObservationFailure.missingWindow }

        let clipping = [overlay, keyboardFrame].compactMap(\.self)
        let viewport = FormScrollGeometry.unobstructedScrollFrame(historyFrame.intersection(windowFrame), target: nil, controls: clipping)
        guard FormScrollGeometry.valid(viewport), viewport.maxY <= overlay.minY + 1 else { throw ObservationFailure.incompleteText }
        return (dock, overlay, viewport, keyboardFrame)
    }

    static func conversationControl(_ control: XCUIElement, in app: XCUIApplication) throws {
        let bounds = try conversationBounds(app)
        XCTAssertTrue(UITestConditions.exists(control) && control.isEnabled && control.isHittable)
        let frame = control.frame
        XCTAssertTrue(FormScrollGeometry.valid(frame) && bounds.dock.contains(frame) && bounds.overlay.contains(frame))
        XCTAssertLessThanOrEqual(bounds.viewport.maxY, frame.minY + 1)
        if let keyboard = bounds.keyboard {
            XCTAssertLessThanOrEqual(frame.maxY, keyboard.minY + 1)
        }
        let back = UITestConditions.element(app, "navigation-back")
        if back.exists {
            XCTAssertFalse(frame.intersects(back.frame))
        }
    }

    /// Match the local preflight alert in the measured composer, above the actual keyboard.
    static func conversationMessage(identifier: String, expected: String, in app: XCUIApplication) throws {
        let matches = app.descendants(matching: .any).matching(identifier: identifier)
        let text = matches.firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard matches.count == 1, let snapshot = try? text.snapshot() else { return false }
            return snapshot.label == expected || snapshot.value as? String == expected
        }, object: nil)
        guard XCTWaiter.wait(for: [ready], timeout: 12) == .completed else {
            XCTFail("Expected local conversation recovery alert did not reach a unique native node.")
            throw ObservationFailure.incompleteText
        }
        let bounds = try conversationBounds(app)
        XCTAssertEqual(matches.count, 1)
        XCTAssertTrue(text.isHittable && FormScrollGeometry.valid(text.frame))
        let frame = text.frame
        XCTAssertTrue(bounds.dock.contains(frame) && bounds.overlay.contains(frame), "Local recovery must fit the measured composer.")
        XCTAssertLessThanOrEqual(bounds.viewport.maxY, frame.minY + 1)
        if let keyboard = bounds.keyboard {
            XCTAssertLessThanOrEqual(frame.maxY, keyboard.minY + 1)
        }
    }

    private enum ObservationFailure: Error { case missingWindow, incompleteText }
}
