import XCTest

@MainActor
enum NavigationUITestConditions {
    struct NativeAction {
        let control: XCUIElement
        let toolbar: XCUIElement
    }

    struct SafeAreaObservation {
        let frame: CGRect
        let top: CGFloat
        let bottom: CGFloat
    }

    /// The test-only root exposes the public native SafeAreaListener event. Compare its actual frame before using the insets for another view.
    static func safeArea(_ app: XCUIApplication, testCase: XCTestCase? = nil) throws -> SafeAreaObservation {
        let marker = UITestConditions.element(app, "native-safe-area-observation")
        XCTAssertTrue(UITestConditions.exists(marker), app.debugDescription)
        let data = try XCTUnwrap(UITestConditions.text(marker).data(using: .utf8))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        if let testCase {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = "native-safe-area-observation"
            attachment.lifetime = .keepAlways
            testCase.add(attachment)
        }
        let frame = try XCTUnwrap(report["frame"] as? [String: Double])
        let insets = try XCTUnwrap(report["insets"] as? [String: Double])
        return try SafeAreaObservation(
            frame: CGRect(x: XCTUnwrap(frame["x"]), y: XCTUnwrap(frame["y"]), width: XCTUnwrap(frame["width"]), height: XCTUnwrap(frame["height"])),
            top: XCTUnwrap(insets["top"]), bottom: XCTUnwrap(insets["bottom"]),
        )
    }

    static func nativeAction(_ app: XCUIApplication, _ identifier: String) throws -> NativeAction {
        let query = app.buttons.matching(identifier: identifier)
        XCTAssertTrue(UITestConditions.exists(query.firstMatch), app.debugDescription)
        // The root glass container and contextual stack expose the same native buttons without an XCUI Toolbar role.
        // Select only observed navigation containers, retaining containment, active geometry and 44-point requirements.
        let bars = app.descendants(matching: .any).matching(NSPredicate(format: "identifier IN %@", ["navigation-native-toolbar", "navigation-root-tabs-glass-backdrop"])).allElementsBoundByIndex
        for bar in bars where bar.exists && bar.isHittable {
            for control in query.allElementsBoundByIndex where control.exists {
                let frame = control.frame
                if frame.width >= 44, frame.height >= 44, bar.frame.insetBy(dx: -1, dy: -1).contains(frame) {
                    return NativeAction(control: control, toolbar: bar)
                }
            }
        }
        throw NSError(domain: "NavigationUITests", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "No active 44-point native control: \(identifier); \(app.debugDescription)"])
    }

    static func tapNative(_ app: XCUIApplication, _ identifier: String) throws {
        let action = try nativeAction(app, identifier)
        // iOS can misreport the child's activation point. Send the touch through its measured active toolbar.
        let offset = CGVector(dx: action.control.frame.midX - action.toolbar.frame.minX,
                              dy: action.control.frame.midY - action.toolbar.frame.minY)
        action.toolbar.coordinate(withNormalizedOffset: .zero).withOffset(offset).tap()
    }

    static func route(_ app: XCUIApplication, markers: [String]) {
        let predicate = NSPredicate { _, _ in
            markers.contains { identifier in
                let element = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
                return element.exists && !element.frame.isEmpty && element.frame.intersects(app.frame)
            }
        }
        if predicate.evaluate(with: nil) {
            return
        }
        let ready = XCTNSPredicateExpectation(predicate: predicate, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed, app.debugDescription)
    }

    static func openTab(_ app: XCUIApplication, _ tab: String, markers: [String]) throws {
        try tapNative(app, "navigation-tab-\(tab)")
        route(app, markers: markers)
    }

    static func scrollToBottom(_ app: XCUIApplication, _ scrollID: String) throws {
        let scroll = UITestConditions.element(app, scrollID)
        XCTAssertTrue(UITestConditions.exists(scroll))
        let viewport = scroll.scrollViews.firstMatch.exists ? scroll.scrollViews.firstMatch : scroll
        let content = viewport.children(matching: .any).allElementsBoundByIndex.filter {
            !$0.frame.isEmpty && $0.frame.width >= viewport.frame.width * 0.5
        }
        guard let anchor = content.max(by: { $0.frame.height < $1.frame.height }) else {
            throw NSError(domain: "NavigationUITests", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Missing measured scroll content: \(scrollID)"])
        }
        // A short import page has real content smaller than its viewport. Its fully contained native frame already proves the bottom without an artificial scroll.
        if anchor.frame.height <= viewport.frame.height, viewport.frame.insetBy(dx: -0.5, dy: -0.5).contains(anchor.frame) {
            return
        }
        var previous = anchor.frame
        for _ in 0 ..< 20 {
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
            start.press(forDuration: 0.05, thenDragTo: end)
            let current = anchor.frame
            if abs(current.minY - previous.minY) < 0.5 {
                return
            }
            previous = current
        }
        throw NSError(domain: "NavigationUITests", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: "Scroll content did not reach a stable bottom: \(scrollID)"])
    }

    static func contentAboveBar(_ app: XCUIApplication, scrollID: String, contentID: String,
                                navigationID: String = "navigation-back") throws
    {
        try scrollToBottom(app, scrollID)
        let content = UITestConditions.element(app, contentID)
        XCTAssertTrue(content.exists && !content.frame.isEmpty)
        let active = try nativeAction(app, navigationID)
        XCTAssertLessThanOrEqual(content.frame.maxY, active.toolbar.frame.minY - 16)
    }
}
