import XCTest

@MainActor
enum NavigationUITestConditions {
    struct NavigationAction {
        let control: XCUIElement
        let toolbar: XCUIElement
    }

    struct SafeAreaObservation {
        let frame: CGRect
        let top: CGFloat
        // Keep the trailing edge from this same native observation, not a device-size assumption.
        let right: CGFloat
        let bottom: CGFloat
    }

    /// Attach one raw navigation marker read; missing or truncated JSON stays unavailable without polling.
    static func observationSnapshot(_ app: XCUIApplication, testCase: XCTestCase, attachmentName: String) -> [String: Any]? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let payload = marker.exists ? UITestConditions.text(marker) : "{\"status\":\"unavailable\"}"
        let data = Data(payload.utf8)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = attachmentName
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// Bind rendered panel bounds to the same process's geometry and adaptive-plan receipt before asserting its axis.
    static func panelSnapshot(_ app: XCUIApplication, frames: [String: CGRect], testCase: XCTestCase) throws {
        let payload = frames.mapValues { frame in
            ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
        }
        let data = try JSONSerialization.data(withJSONObject: payload)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "adaptive-panel-frames"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        _ = observationSnapshot(app, testCase: testCase, attachmentName: "adaptive-panel-native-geometry")
    }

    /// Read the existing interval-refreshed marker once; missing data remains unavailable, never a forced live snapshot.
    static func symptomAccessorySnapshot(_ app: XCUIApplication, testCase: XCTestCase, phase: String) {
        let snapshot = observationSnapshot(app, testCase: testCase, attachmentName: "symptom-accessory-\(phase)-raw")
        let trace = snapshot?["symptomScrollTrace"] as? [String: Any]
        let payload: [String: Any] = [
            "phase": phase, "sampled": true,
            "markerReadAtMs": Date().timeIntervalSince1970 * 1000,
            "bridgeSampleAtMs": snapshot?["atMs"] as Any? ?? NSNull(),
            "descriptionAccessory": trace?["descriptionAccessory"] as Any? ?? ["status": "unavailable"],
        ]
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{\"status\":\"unavailable\"}".utf8)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "symptom-accessory-\(phase)-sample"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    /// The test-only root exposes the public native SafeAreaListener event. Compare its actual frame before using the insets for another view.
    static func safeArea(_ app: XCUIApplication, testCase: XCTestCase? = nil) throws -> SafeAreaObservation {
        let marker = UITestConditions.element(app, "safe-area-test-observation")
        XCTAssertTrue(UITestConditions.exists(marker), app.debugDescription)
        let data = try XCTUnwrap(UITestConditions.text(marker).data(using: .utf8))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        if let testCase {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = "safe-area-test-observation"
            attachment.lifetime = .keepAlways
            testCase.add(attachment)
        }
        let frame = try XCTUnwrap(report["frame"] as? [String: Double])
        let insets = try XCTUnwrap(report["insets"] as? [String: Double])
        return try SafeAreaObservation(
            frame: CGRect(x: XCTUnwrap(frame["x"]), y: XCTUnwrap(frame["y"]), width: XCTUnwrap(frame["width"]), height: XCTUnwrap(frame["height"])),
            top: XCTUnwrap(insets["top"]), right: XCTUnwrap(insets["right"]), bottom: XCTUnwrap(insets["bottom"]),
        )
    }

    static func navigationAction(_ app: XCUIApplication, _ identifier: String) throws -> NavigationAction {
        let query = app.buttons.matching(identifier: identifier)
        XCTAssertTrue(UITestConditions.exists(query.firstMatch), app.debugDescription)
        // The root glass container and contextual stack expose the same native buttons without an XCUI Toolbar role.
        // Select only observed navigation containers, retaining containment, active geometry and 44-point requirements.
        let bars = app.descendants(matching: .any).matching(NSPredicate(format: "identifier IN %@", ["navigation-toolbar", "navigation-root-tabs-glass-backdrop"])).allElementsBoundByIndex
        for bar in bars where bar.exists && bar.isHittable {
            let barFrame = bar.frame
            for control in query.allElementsBoundByIndex where control.exists {
                let frame = control.frame
                if frame.width >= 44, frame.height >= 44, barFrame.insetBy(dx: -1, dy: -1).contains(frame) {
                    return NavigationAction(control: control, toolbar: bar)
                }
            }
        }
        throw NSError(domain: "NavigationUITests", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "No active 44-point navigation control: \(identifier); \(app.debugDescription)"])
    }

    static func tapNavigation(_ app: XCUIApplication, _ identifier: String) throws {
        let action = try navigationAction(app, identifier)
        // iOS can misreport the child's activation point. Send the touch through its measured active toolbar.
        // Read each frame once for this gesture; later gestures must observe the elements again.
        let controlFrame = action.control.frame
        let toolbarFrame = action.toolbar.frame
        let offset = CGVector(dx: controlFrame.midX - toolbarFrame.minX,
                              dy: controlFrame.midY - toolbarFrame.minY)
        action.toolbar.coordinate(withNormalizedOffset: .zero).withOffset(offset).tap()
    }

    static func route(_ app: XCUIApplication, markers: [String]) {
        let predicate = NSPredicate { _, _ in
            markers.contains { identifier in
                let element = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
                guard element.exists else { return false }
                let frame = element.frame
                return !frame.isEmpty && frame.intersects(app.frame)
            }
        }
        if predicate.evaluate(with: nil) {
            return
        }
        let ready = XCTNSPredicateExpectation(predicate: predicate, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, app.debugDescription)
    }

    static func openTab(_ app: XCUIApplication, _ tab: String, markers: [String]) throws {
        try tapNavigation(app, "navigation-tab-\(tab)")
        route(app, markers: markers)
    }

    static func scrollToBottom(_ app: XCUIApplication, _ scrollID: String) throws {
        let scroll = UITestConditions.element(app, scrollID)
        XCTAssertTrue(UITestConditions.exists(scroll))
        let viewport = scroll.scrollViews.firstMatch.exists ? scroll.scrollViews.firstMatch : scroll
        // Rank one coherent observation rather than repeatedly querying accessibility during comparison.
        let viewportFrame = viewport.frame
        let content = viewport.children(matching: .any).allElementsBoundByIndex.map {
            (element: $0, frame: $0.frame)
        }.filter {
            !$0.frame.isEmpty && $0.frame.width >= viewportFrame.width * 0.5
        }
        guard let anchor = content.max(by: { $0.frame.height < $1.frame.height }) else {
            throw NSError(domain: "NavigationUITests", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Missing measured scroll content: \(scrollID)"])
        }
        // A short import page has real content smaller than its viewport. Its fully contained native frame already proves the bottom without an artificial scroll.
        if anchor.frame.height <= viewportFrame.height, viewportFrame.insetBy(dx: -0.5, dy: -0.5).contains(anchor.frame) {
            return
        }
        var previous = anchor.frame
        for _ in 0 ..< 20 {
            // Capture each origin once. Resolving the moving scroll element at
            // every synthesized touch adds AX round trips and can move the origin.
            // Keep the same travel and independently observe the content afterward.
            let applicationFrame = app.frame
            let scrollFrame = scroll.frame
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let x = scrollFrame.midX - applicationFrame.minX
            let start = origin.withOffset(CGVector(dx: x, dy: scrollFrame.minY + scrollFrame.height * 0.75 - applicationFrame.minY))
            let end = origin.withOffset(CGVector(dx: x, dy: scrollFrame.minY + scrollFrame.height * 0.2 - applicationFrame.minY))
            start.press(forDuration: 0.05, thenDragTo: end)
            let current = anchor.element.frame
            if abs(current.minY - previous.minY) < 0.5 {
                return
            }
            previous = current
        }
        throw NSError(domain: "NavigationUITests", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: "Scroll content did not reach a stable bottom: \(scrollID)"])
    }

    /// Compare the shared frame against the real keyboard or public window edge, never generated pixels.
    static func assertSharedViewport(_ app: XCUIApplication, keyboard: XCUIElement? = nil, testCase: XCTestCase) throws {
        var lastBottom: Double?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let marker = UITestConditions.element(app, "navigation-test-observation")
            guard marker.exists,
                  let report = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any],
                  let lifecycle = report["lifecycle"] as? [[String: Any]],
                  let event = lifecycle.last(where: { $0["event"] as? String == "navigation-content-frame" }),
                  let json = event["frame"] as? String,
                  let shared = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
                  let frame = shared["availableContentFrame"] as? [String: Double],
                  let y = frame["y"], let height = frame["height"], height > 0,
                  let reference = report["windowGeometry"] as? [String: Any],
                  let window = reference["windowBounds"] as? [String: Double],
                  let insets = reference["safeAreaInsets"] as? [String: Double],
                  let windowY = window["y"], let windowHeight = window["height"], let bottom = insets["bottom"]
            else { return false }
            lastBottom = y + height
            if let keyboard {
                return y + height <= Double(keyboard.frame.minY) + 1
            }
            return abs(y + height - (windowY + windowHeight - bottom)) <= 1
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, "Shared viewport bottom: \(String(describing: lastBottom))")
        _ = observationSnapshot(app, testCase: testCase, attachmentName: keyboard == nil ? "shared-viewport-restored" : "shared-viewport-keyboard")
    }

    static func contentAboveBar(_ app: XCUIApplication, scrollID: String, contentID: String,
                                navigationID: String = "navigation-back") throws
    {
        try scrollToBottom(app, scrollID)
        let content = UITestConditions.element(app, contentID)
        XCTAssertTrue(content.exists && !content.frame.isEmpty)
        let active = try navigationAction(app, navigationID)
        XCTAssertLessThanOrEqual(content.frame.maxY, active.toolbar.frame.minY - 16)
    }
}
