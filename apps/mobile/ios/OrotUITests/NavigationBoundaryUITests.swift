import XCTest

/// Local diagnostics locate a reproduction boundary; neither case replaces N030 or proves product acceptance.
final class NavigationBoundaryUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testUIKitBoundaryShortThenFullEdgeBack() throws {
        try compare("uikit")
    }

    @MainActor
    func testRNSBoundaryShortThenFullEdgeBack() throws {
        try compare("rns")
    }

    @MainActor
    private func compare(_ boundary: String) throws {
        guard let inputMode = ProcessInfo.processInfo.environment["OROT_LOCAL_NAVIGATION_INPUT_MODE"],
              ["cancel-then-full", "fresh-full-only"].contains(inputMode)
        else {
            throw NSError(domain: "NavigationBoundary", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "An explicit supported local input mode is required"])
        }
        // The case identifier alone cannot distinguish this diagnostic axis from the original two-gesture condition.
        let input: [String: Any] = ["boundary": boundary, "inputMode": inputMode,
                                    "plannedGestures": inputMode == "fresh-full-only" ? 1 : 2]
        let inputData = try JSONSerialization.data(withJSONObject: input)
        let inputAttachment = XCTAttachment(data: inputData, uniformTypeIdentifier: "public.json")
        inputAttachment.name = "local-boundary-input"
        inputAttachment.lifetime = .keepAlways
        add(inputAttachment)
        print("LOCAL_BOUNDARY_INPUT " + String(decoding: inputData, as: UTF8.self))
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_TEST_NAVIGATION_BOUNDARY", boundary,
                               "-OROT_TEST_NAVIGATION_INPUT_MODE", inputMode,
                               "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        let rootTitle = UITestConditions.element(app, "boundary-root-title")
        XCTAssertTrue(UITestConditions.exists(rootTitle) && rootTitle.isHittable)
        let root = UITestConditions.element(app, "boundary-root-surface")
        try geometry(root, in: app)
        try observedStack(app, boundary: boundary, depth: 1, inputMode: inputMode)
        capture(app, "\(boundary)-root-preflight")
        let open = UITestConditions.element(app, "boundary-open-child")
        XCTAssertTrue(open.exists && open.isHittable)
        open.tap()
        let child = UITestConditions.element(app, "boundary-child-surface")
        let childTitle = UITestConditions.element(app, "boundary-child-title")
        XCTAssertTrue(UITestConditions.exists(childTitle) && childTitle.isHittable)
        // Fabric can publish the child's viewport while the push is still active. First observe its existing completion condition.
        let observeBeforeGeometry = boundary == "rns" || inputMode == "fresh-full-only"
        if observeBeforeGeometry {
            try observedStack(app, boundary: boundary, depth: 2, inputMode: inputMode)
        }
        try geometry(child, in: app)
        if !observeBeforeGeometry {
            try observedStack(app, boundary: boundary, depth: 2, inputMode: inputMode)
        }
        capture(app, "\(boundary)-child-preflight")
        observation(app, "\(boundary)-before-edge-back")
        // Copy N030's inputs, including requested velocity. Actual UIKit callback velocity is recorded separately.
        if inputMode == "cancel-then-full" {
            edgeBack(child, in: app, fraction: 0.08, velocity: XCUIGestureVelocity(rawValue: 80))
            XCTAssertTrue(child.exists && child.isHittable)
            observation(app, "\(boundary)-after-short-edge-back")
            capture(app, "\(boundary)-after-short-edge-back")
        }
        edgeBack(child, in: app, fraction: 0.85, velocity: .fast)
        observation(app, "\(boundary)-after-full-edge-back")
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            rootTitle.exists && rootTitle.isHittable && !child.exists
        }, object: nil)
        let result = XCTWaiter.wait(for: [returned], timeout: 30)
        observation(app, "\(boundary)-after-return-wait")
        capture(app, "\(boundary)-after-return-wait")
        XCTAssertEqual(result, .completed, app.debugDescription)
    }

    @MainActor
    private func geometry(_ surface: XCUIElement, in app: XCUIApplication) throws {
        let safe = try NavigationUITestConditions.safeArea(app, testCase: self)
        // This local experiment requires the exact iPhone18Pro/iOS27 viewport observed by original N030 at 5656.
        // A mismatching surface fails before any swipe, rather than silently comparing different touch paths.
        XCTAssertEqual(app.frame.width, 402, accuracy: 0.5)
        XCTAssertEqual(app.frame.height, 874, accuracy: 0.5)
        XCTAssertEqual(safe.frame, CGRect(x: 0, y: 0, width: 402, height: 874))
        XCTAssertEqual(safe.top, 62, accuracy: 0.5)
        XCTAssertEqual(surface.frame.minX, 0, accuracy: 0.5)
        XCTAssertEqual(surface.frame.minY, 62, accuracy: 0.5)
        XCTAssertEqual(surface.frame.width, 402, accuracy: 0.5)
        XCTAssertEqual(surface.frame.height, 812, accuracy: 0.5)
        let geometry: [String: Any] = ["surface": surface.identifier,
                                       "appFrame": NSCoder.string(for: app.frame),
                                       "surfaceFrame": NSCoder.string(for: surface.frame),
                                       "windowTopInset": safe.top,
                                       "visibleNavigationBars": app.navigationBars.count,
                                       "fixtureContentHeight": 1100,
                                       "scope": "local boundary comparison, not product acceptance"]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: geometry), uniformTypeIdentifier: "public.json")
        attachment.name = "geometry-\(surface.identifier)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func observedStack(_ app: XCUIApplication, boundary: String, depth: Int, inputMode: String) throws {
        var navigation: [String: Any]?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let report = self.report(app), let lifecycle = report["lifecycle"] as? [[String: Any]],
                  lifecycle.contains(where: { $0["event"] as? String == "boundary-input-mode"
                          && $0["boundary"] as? String == boundary && $0["inputMode"] as? String == inputMode
                  }),
                  let stacks = report["navigation"] as? [[String: Any]],
                  stacks.count == 1, stacks[0]["depth"] as? Int == depth,
                  let transition = stacks[0]["transition"] as? [String: Any], transition.isEmpty else { return false }
            navigation = stacks[0]
            return true
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        let stack = try XCTUnwrap(navigation)
        XCTAssertEqual(stack["controller"] as? String, boundary == "uikit" ? "UINavigationController" : "RNSNavigationController")
        // The system bar versus hidden RNS header is a known confound, not something to normalize through delegates.
        XCTAssertEqual(app.navigationBars.count, boundary == "uikit" ? 1 : 0)
        if depth == 2 {
            let gestures = try XCTUnwrap(stack["gestures"] as? [[String: Any]])
            XCTAssertTrue(gestures.contains { gesture in
                (gesture["roles"] as? [String])?.contains("edge-pop") == true && gesture["enabled"] as? Bool == true
            }, "Missing enabled public edge-pop recognizer; no gesture input is permitted")
        }
        if boundary == "rns" {
            let screens = try XCTUnwrap(stack["nativeScreens"] as? [String: Any])
            let endpoints = try XCTUnwrap(screens["stack"] as? [[String: Any]])
            XCTAssertEqual(endpoints.count, depth)
            XCTAssertTrue(endpoints.allSatisfy { $0["preventNativeDismiss"] as? Bool == false })
        }
        observation(app, "\(boundary)-stack-depth-\(depth)")
    }

    @MainActor
    private func report(_ app: XCUIApplication) -> [String: Any]? {
        let marker = UITestConditions.element(app, "native-navigation-observation")
        guard marker.exists, let data = UITestConditions.text(marker).data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    @MainActor
    private func observation(_ app: XCUIApplication, _ name: String) {
        let marker = UITestConditions.element(app, "native-navigation-observation")
        let attachment = XCTAttachment(data: Data(UITestConditions.text(marker).utf8), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func edgeBack(_ surface: XCUIElement, in app: XCUIApplication, fraction: CGFloat, velocity: XCUIGestureVelocity) {
        let frame = surface.frame
        XCTAssertFalse(frame.isEmpty)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: frame.minX + frame.width * 0.01, dy: frame.midY))
        let end = origin.withOffset(CGVector(dx: frame.minX + frame.width * (0.01 + fraction), dy: frame.midY))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
