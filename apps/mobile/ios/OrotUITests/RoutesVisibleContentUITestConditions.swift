import XCTest

/// Route-specific observations preserve the floating composer's and long report's real native geometry.
@MainActor
enum RoutesVisibleContentUITestConditions {
    /// Observe keyboardDidShow and two matching UIKit workspace layouts; never wait for Send to clear.
    static func keyboardReady(_ app: XCUIApplication, baseline: CGRect, focusedAt: Double) throws {
        let keyboard = app.keyboards.firstMatch
        let eventMarker = UITestConditions.element(app, "ai-feature-visit-questions-keyboard-visible")
        let navigationMarker = UITestConditions.element(app, "navigation-test-observation")
        let host = UITestConditions.element(app, "conversation-workspace-host")
        let workspace = UITestConditions.element(app, "conversation-workspace")
        var previous: [CGRect]?
        var last = "No complete keyboard and workspace observation"
        // Each attempt is a real snapshot; an unresolved transition fails after this fixed budget.
        for _ in 0 ..< 8 {
            guard keyboard.exists, eventMarker.exists, navigationMarker.exists, host.exists, workspace.exists,
                  let window = FormWindowOwnership.resolve(app, scroll: host, target: workspace, reportFailure: false)
            else { previous = nil; continue }
            let parts = eventMarker.label.split(separator: ":")
            guard parts.count == 3, parts[0] == "keyboard-visible", let y = Double(parts[1]), let height = Double(parts[2]),
                  let report = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(navigationMarker).utf8)) as? [String: Any],
                  let events = report["lifecycle"] as? [[String: Any]],
                  let latest = events.last(where: { $0["event"] as? String == "navigation-content-frame" }),
                  let at = latest["atMs"] as? Double, at >= focusedAt,
                  let json = latest["frame"] as? String,
                  let data = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
                  let shared = data["availableContentFrame"] as? [String: Double],
                  let sx = shared["x"], let sy = shared["y"], let sw = shared["width"], let sh = shared["height"]
            else { previous = nil; continue }
            let windowFrame = window.frame
            let keyboardEvent = CGRect(x: windowFrame.minX, y: y, width: windowFrame.width, height: height)
            let keyboardAX = keyboard.frame
            let sharedFrame = CGRect(x: windowFrame.minX + sx, y: windowFrame.minY + sy, width: sw, height: sh)
            let hostFrame = host.frame
            let workspaceFrame = workspace.frame
            let current = [keyboardEvent, keyboardAX, sharedFrame, hostFrame, workspaceFrame]
            last = "keyboardEvent=\(keyboardEvent), keyboardAX=\(keyboardAX), baseline=\(baseline), shared=\(sharedFrame), host=\(hostFrame), workspace=\(workspaceFrame)"
            guard RoutesKeyboardReadiness.ready(keyboardEvent: keyboardEvent, keyboardAX: keyboardAX, baseline: baseline, shared: sharedFrame, host: hostFrame, workspace: workspaceFrame) else { previous = nil; continue }
            if let previous, zip(previous, current).allSatisfy({ $0.0.equalTo($0.1) }) {
                return
            }
            previous = current
        }
        XCTFail("Keyboard and workspace did not converge: \(last)")
        throw ObservationFailure.keyboardNotReady
    }

    static func composer(_ control: XCUIElement, in app: XCUIApplication, observationSession: String? = nil, testCase: XCTestCase? = nil) throws {
        let dock = UITestConditions.element(app, "rag-conversation-composer")
        let history = UITestConditions.element(app, "rag-conversation-history")
        XCTAssertTrue(UITestConditions.exists(control))
        XCTAssertTrue(UITestConditions.exists(dock))
        XCTAssertTrue(UITestConditions.exists(history))
        XCTAssertTrue(control.isHittable, control.debugDescription)
        XCTAssertTrue(dock.frame.contains(control.frame), "Control: \(control.frame), dock: \(dock.frame)")
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            // Preserve the failed observation before sampling diagnostics; no later layout can change the assertion.
            let startedAt = Date().timeIntervalSince1970 * 1000
            let controlFrame = control.frame
            let keyboardFrame = keyboard.frame
            let endedAt = Date().timeIntervalSince1970 * 1000
            if controlFrame.maxY > keyboardFrame.minY + 1, let observationSession, let testCase {
                let geometry = XCTAttachment(string: "startedAtMs=\(startedAt) endedAtMs=\(endedAt) control=\(controlFrame) keyboard=\(keyboardFrame) nativeAndAXSamples=subsequent")
                geometry.name = "conversation-keyboard-boundary-observation"
                geometry.lifetime = .keepAlways
                testCase.add(geometry)
                let sample = ConversationHitUITestObservation.sample(control)
                ConversationHitUITestObservation.capture(app, send: control, initial: sample, session: observationSession, testCase: testCase)
            }
            XCTAssertLessThanOrEqual(controlFrame.maxY, keyboardFrame.minY + 1)
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

    private enum ObservationFailure: Error { case missingWindow, incompleteText, keyboardNotReady }
}
