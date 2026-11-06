import XCTest

/// Verifies direct or overflow conversation actions in the measured Duo lane.
@MainActor
extension FeatureEntryDuoActionConditions {
    struct SourceBaseline {
        let sample: NavigationCurrentRouteObservation.Sample
        let tappedAtMs: Double
    }

    /// Keep the current stack and its window identity before the source tap.
    static func sourceTransitionBaseline(_ app: XCUIApplication, testCase: XCTestCase) throws -> SourceBaseline {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let raw = marker.exists ? UITestConditions.text(marker) : "unavailable"
        let tree = try app.snapshot()
        let attachment = XCTAttachment(string: "readAtMs=\(Date().timeIntervalSince1970 * 1000)\n\(raw)\n\(tree.debugDescription)")
        attachment.name = "duo-source-baseline"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        let report = try XCTUnwrap((try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any])
        let sample = try XCTUnwrap(NavigationCurrentRouteObservation.sample(report))
        try assertMarkerWindow(tree, markerID: "rag-conversation-screen", report: report)
        return SourceBaseline(sample: sample, tappedAtMs: Date().timeIntervalSince1970 * 1000)
    }

    /// Require the same live stack and a post-tap transition for its current source route.
    static func waitForSourceTransition(_ app: XCUIApplication, baseline: SourceBaseline, testCase _: XCTestCase) throws {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let screen = UITestConditions.element(app, "ai-feature-source-detail")
            guard screen.exists, let report = sourceObservation(app),
                  NavigationCurrentRouteObservation.isSourceReady(report, baseline: baseline.sample, tappedAtMs: baseline.tappedAtMs),
                  let navigation = report["navigation"] as? [[String: Any]],
                  navigation.contains(where: { $0["visible"] as? Bool == true && ($0["depth"] as? Int ?? 0) >= 2 }),
                  let geometry = report["windowGeometry"] as? [String: Any],
                  let dock = geometry["dockControls"] as? [String: Any],
                  let frame = dock["windowFrameInScreen"] as? [String: Double],
                  let x = frame["x"], let y = frame["y"], let width = frame["width"], let height = frame["height"],
                  !screen.frame.isEmpty, screen.frame.intersects(CGRect(x: x, y: y, width: width, height: height)) else { return false }
            return true
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, "The current source route must finish its own transition")
    }

    /// Join accessibility to the native window by its frame, never by route ancestry.
    private static func assertMarkerWindow(_ tree: XCUIElementSnapshot, markerID: String, report: [String: Any]) throws {
        var matches: [[XCUIElementSnapshot]] = []
        func visit(_ node: XCUIElementSnapshot, ancestors: [XCUIElementSnapshot]) {
            if node.identifier == markerID {
                matches.append(ancestors.filter { $0.elementType == .window })
            }
            for child in node.children {
                visit(child, ancestors: ancestors + [node])
            }
        }
        visit(tree, ancestors: [])
        XCTAssertEqual(matches.count, 1)
        let windows = try XCTUnwrap(matches.first)
        XCTAssertEqual(windows.count, 1)
        let actual = try XCTUnwrap(windows.first).frame
        let geometry = try XCTUnwrap(report["windowGeometry"] as? [String: Any])
        let dock = try XCTUnwrap(geometry["dockControls"] as? [String: Any])
        let frame = try XCTUnwrap(dock["windowFrameInScreen"] as? [String: Double])
        for (key, value) in [("x", actual.minX), ("y", actual.minY), ("width", actual.width), ("height", actual.height)] {
            XCTAssertEqual(try CGFloat(XCTUnwrap(frame[key])), value, accuracy: 0.5)
        }
    }

    private static func sourceObservation(_ app: XCUIApplication) -> [String: Any]? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8))) as? [String: Any]
    }

    /// Capture one source-screen tree and the existing native observation before any Back gesture.
    static func captureSourceBack(_ app: XCUIApplication, baseline: SourceBaseline, testCase: XCTestCase) throws {
        let started = Date().timeIntervalSince1970 * 1000
        let tree = try app.snapshot()
        var back: [String] = []
        var keyboards: [String] = []
        func visit(_ node: XCUIElementSnapshot, ancestors: [XCUIElementSnapshot]) {
            if node.identifier == "navigation-back" {
                let windows = ancestors.filter { $0.elementType == .window }
                back.append("type=\(node.elementType.rawValue) frame=\(node.frame) windows=\(windows.map(\.frame))")
            }
            if node.elementType == .keyboard {
                keyboards.append("frame=\(node.frame)")
            }
            for child in node.children {
                visit(child, ancestors: ancestors + [node])
            }
        }
        visit(tree, ancestors: [])
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let native = marker.exists ? UITestConditions.text(marker) : "unavailable"
        let ended = Date().timeIntervalSince1970 * 1000
        let state = XCTAttachment(string: "sampleStartMs=\(started) sampleEndMs=\(ended) backCount=\(back.count)\n\(back.joined(separator: "\n"))\nkeyboardCount=\(keyboards.count)\n\(keyboards.joined(separator: "\n"))\nappFrame=\(app.frame)")
        state.name = "duo-source-back-state"
        state.lifetime = .keepAlways
        testCase.add(state)
        let nativeAttachment = XCTAttachment(string: native)
        nativeAttachment.name = "duo-source-back-native"
        nativeAttachment.lifetime = .keepAlways
        testCase.add(nativeAttachment)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "duo-source-back-hierarchy"
        hierarchy.lifetime = .keepAlways
        testCase.add(hierarchy)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "duo-source-back-screen"
        screenshot.lifetime = .keepAlways
        testCase.add(screenshot)
        let report = try XCTUnwrap((try? JSONSerialization.jsonObject(with: Data(native.utf8))) as? [String: Any])
        XCTAssertTrue(NavigationCurrentRouteObservation.isSourceReady(report, baseline: baseline.sample, tappedAtMs: baseline.tappedAtMs))
        try assertMarkerWindow(tree, markerID: "ai-feature-source-detail", report: report)
        print("OROT_DUO_SOURCE_BACK_CAPTURED startMs=\(started) endMs=\(ended) backCount=\(back.count)")
    }

    static func verify(_ app: XCUIApplication, toolbar: XCUIElement, viewport: CGRect) throws {
        let history = UITestConditions.element(app, "rag-conversation-sessions-toggle")
        let newSession = UITestConditions.element(app, "rag-conversation-new-session")
        if history.exists, newSession.exists {
            XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "rag-conversation-sessions-toggle").count, 1)
            XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "rag-conversation-new-session").count, 1)
            for (action, label) in [(history, "대화 목록"), (newSession, "새 대화")] {
                XCTAssertTrue(action.isHittable && action.isEnabled && action.label.contains(label), app.debugDescription)
                XCTAssertGreaterThanOrEqual(action.frame.width, 44)
                XCTAssertGreaterThanOrEqual(action.frame.height, 44)
                XCTAssertTrue(toolbar.frame.insetBy(dx: -1, dy: -1).contains(action.frame))
                XCTAssertGreaterThanOrEqual(action.frame.minX, viewport.maxX - 0.5)
            }
            XCTAssertLessThan(history.frame.minY, newSession.frame.minY)
            XCTAssertFalse(history.frame.intersects(newSession.frame))
            return
        }
        // The shared dock uses the system sheet when the toolbar cannot fit both actions.
        let more = app.buttons["navigation-page-action-overflow"]
        XCTAssertEqual(app.buttons.matching(identifier: "navigation-page-action-overflow").count, 1)
        XCTAssertTrue(more.exists && more.isHittable && more.isEnabled, app.debugDescription)
        XCTAssertGreaterThanOrEqual(more.frame.width, 44)
        XCTAssertGreaterThanOrEqual(more.frame.height, 44)
        XCTAssertTrue(toolbar.frame.insetBy(dx: -1, dy: -1).contains(more.frame))
        XCTAssertGreaterThanOrEqual(more.frame.minX, viewport.maxX - 0.5)
        more.tap()
        let sheet = app.sheets.firstMatch
        XCTAssertTrue(sheet.exists, app.debugDescription)
        let items = ["대화 목록", "새 대화", "동작 메뉴 닫기"].map { label -> XCUIElement in
            let matches = app.buttons.matching(NSPredicate(format: "label == %@", label))
            XCTAssertEqual(matches.count, 1, app.debugDescription)
            let item = matches.firstMatch
            XCTAssertTrue(item.exists && item.isHittable && item.isEnabled, app.debugDescription)
            XCTAssertTrue(sheet.frame.insetBy(dx: -1, dy: -1).contains(item.frame))
            let visible = item.frame.intersection(app.frame)
            XCTAssertGreaterThanOrEqual(visible.width, 44)
            XCTAssertGreaterThanOrEqual(visible.height, 44)
            return item
        }
        XCTAssertLessThan(items[0].frame.minY, items[1].frame.minY)
        XCTAssertFalse(items[0].frame.intersects(items[1].frame))
        items[2].tap()
        XCTAssertFalse(sheet.exists, "Closing the action sheet must return to the conversation")
    }
}
