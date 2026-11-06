import XCTest

/// Exercises the production Home route with a local appointment fixture and live native navigation geometry.
final class HomeDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Measure the large-text regression independently of scroll-driven reachability.
    @MainActor
    func testLargeTextHomeActionsStayWithinContentWidth() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        let page = UITestConditions.element(app, "home-overview-sections")
        XCTAssertTrue(page.waitForAppearance())
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        let identifiers = ["home-prepare-visit", "home-metrics-edit"]
        // The section exists while the appointment and metric fixtures are still loading.
        for identifier in identifiers {
            XCTAssertTrue(UITestConditions.element(app, identifier).waitForAppearance(), identifier)
        }
        // The edit action is disabled until the metric read completes and its cards are rendered.
        let edit = UITestConditions.element(app, "home-metrics-edit")
        let metricsReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in edit.isEnabled }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [metricsReady]), .completed)
        let pageFrame = page.frame
        XCTAssertGreaterThan(pageFrame.width, 0)
        var previousY = -CGFloat.infinity
        for identifier in identifiers {
            let action = UITestConditions.element(app, identifier)
            XCTAssertTrue(action.exists, identifier)
            let frame = action.frame
            XCTAssertGreaterThanOrEqual(frame.height, 44, identifier)
            XCTAssertGreaterThan(frame.minY, previousY, identifier)
            XCTAssertGreaterThanOrEqual(frame.minX, pageFrame.minX - 1, identifier)
            XCTAssertLessThanOrEqual(frame.maxX, pageFrame.maxX + 1, identifier)
            previousY = frame.minY
        }
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertLessThanOrEqual(pageFrame.maxX, navigation.toolbar.frame.minX + 1)
        }
    }

    /// End-of-content clearance is a native scroll boundary, independent of Home action activation.
    @MainActor
    func testHomeContentClearsBottomNavigation() throws {
        let app = XCUIApplication()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        XCUIDevice.shared.orientation = .portrait
        for category in ["UICTContentSizeCategoryLarge", "UICTContentSizeCategoryAccessibilityXXXL"] {
            app.launchArguments = [
                "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
                "-OROT_HOME_APPOINTMENT_TIMING", "YES",
                "-UIPreferredContentSizeCategoryName", category,
                "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            ]
            app.launch()
            XCTAssertTrue(UITestConditions.element(app, "welcome-title").waitForAppearance())
            try verifyBottomClearance(app)
            if category == "UICTContentSizeCategoryLarge" {
                let portraitWidth = app.frame.width
                XCUIDevice.shared.orientation = .landscapeLeft
                let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    let frame = app.frame
                    return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
                }, object: nil)
                XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed)
                try verifyBottomClearance(app)
                app.terminate()
                XCUIDevice.shared.orientation = .portrait
            }
        }
    }

    @MainActor
    private func verifyBottomClearance(_ app: XCUIApplication) throws {
        // The endpoint must represent populated content, not an earlier loading layout.
        for identifier in ["home-prepare-visit", "home-metrics-edit"] {
            XCTAssertTrue(UITestConditions.element(app, identifier).waitForAppearance(), identifier)
        }
        let edit = UITestConditions.element(app, "home-metrics-edit")
        let metricsReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in edit.isEnabled }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [metricsReady]), .completed)
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        if navigation.toolbar.frame.height <= navigation.toolbar.frame.width {
            try NavigationUITestConditions.contentAboveBar(
                app,
                scrollID: "navigation-route-scroll",
                contentID: "home-recent-changes",
                navigationID: "navigation-tab-home",
            )
        }
    }

    @MainActor
    func testHomeSummariesReflowAndVisitPreparationRemainsReachable() throws {
        let app = XCUIApplication()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            // Enable the native marker consumed by the rotation diagnostics below.
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryLarge",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        XCTAssertTrue(UITestConditions.element(app, "welcome-title").waitForAppearance())

        try verifyHomePanelsAndNavigationLane(app)
        let portraitFrame = app.frame
        let portraitWidth = portraitFrame.width
        logHomeRotationGeometry(app, phase: "before")
        XCUIDevice.shared.orientation = .landscapeLeft
        let observationStarted = ProcessInfo.processInfo.systemUptime
        var samples = 0
        var lastFrame = portraitFrame
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            samples += 1
            let frame = app.frame
            lastFrame = frame
            if samples == 1 || samples == 100 {
                // Keep the device request and both public frame observations distinct from the reflow oracle.
                let window = app.windows.firstMatch
                let windowFrame = window.exists ? String(describing: window.frame) : "unavailable"
                print("OROT_HOME_ROTATION sample=\(samples) device=\(XCUIDevice.shared.orientation.rawValue) initialApp=\(portraitFrame) app=\(frame) window=\(windowFrame)")
                self.logHomeRotationGeometry(app, phase: "sample-\(samples)")
            }
            return frame.width > frame.height && abs(frame.width - portraitWidth) > 0.5
        }, object: nil)
        // This provisional diagnostic budget is not a rotation timing guarantee; synchronous AX reads may exceed it.
        let rotationResult = XCTWaiter.wait(for: [landscape], timeout: 10)
        let elapsed = ProcessInfo.processInfo.systemUptime - observationStarted
        print("OROT_HOME_ROTATION_END result=\(rotationResult.rawValue) elapsedSeconds=\(elapsed) samples=\(samples) device=\(XCUIDevice.shared.orientation.rawValue) lastApp=\(lastFrame)")
        logHomeRotationGeometry(app, phase: "end")
        XCTAssertEqual(rotationResult, .completed, "The requested landscape frame was not observed within the diagnostic window")
        guard rotationResult == .completed else { return }
        try verifyHomePanelsAndNavigationLane(app)

        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = [
            "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_HOME_APPOINTMENT_TIMING", "YES",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        XCTAssertTrue(UITestConditions.element(app, "welcome-title").waitForAppearance())
        try verifyHomePanelsAndNavigationLane(app)
    }

    /// The test marker keeps UIKit scene geometry separate from XCTest application and window frames.
    @MainActor
    private func logHomeRotationGeometry(_ app: XCUIApplication, phase: String) {
        HomeMetricGeometryConditions.logRotation(app, phase: phase, testCase: self)
    }

    /// Reflow metric checkboxes and Home actions, keeping every native target reachable with larger text.
    @MainActor
    private func verifyHomePanelsAndNavigationLane(
        _ app: XCUIApplication,
    ) throws {
        let page = UITestConditions.element(app, "home-overview-sections")
        XCTAssertTrue(page.waitForAppearance())
        let navigation: NavigationUITestConditions.NavigationAction
        do {
            navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        } catch {
            // Preserve the existing geometry receipt after failure without changing the selection oracle.
            _ = NavigationUITestConditions.observationSnapshot(app, testCase: self, attachmentName: "home-navigation-failure-geometry")
            throw error
        }
        XCTAssertTrue(navigation.control.isSelected)
        for identifier in ["home-metric-sleep", "home-metric-heartRate"] {
            let card = UITestConditions.element(app, identifier)
            XCTAssertTrue(card.waitForAppearance())
            // Metric cards have no activation handler; XCTest attempts to reveal the selected element.
            card.tap()
            XCTAssertTrue(card.exists && card.isHittable, identifier)
            HomeMetricGeometryConditions.captureCard(card, in: app, testCase: self)
            if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
                XCTAssertLessThanOrEqual(card.frame.maxX, navigation.toolbar.frame.minX + 1, identifier)
            }
        }
        XCTAssertTrue(navigation.control.isSelected)
        HomeMetricGeometryConditions.verify(app, testCase: self)
        var previousY: CGFloat = -1
        for identifier in ["home-prepare-visit", "home-metrics-edit"] {
            let action = UITestConditions.element(app, identifier)
            XCTAssertTrue(action.waitForAppearance())
            if identifier == "home-metrics-edit" {
                let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in action.isEnabled }, object: nil)
                XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
            }
            // Frames preserve geometry checks independently of automatic target reveal.
            let frame = action.frame
            let pageFrame = page.frame
            XCTAssertFalse(frame.isEmpty, identifier)
            XCTAssertFalse(pageFrame.isEmpty, identifier)
            XCTAssertGreaterThanOrEqual(frame.height, 44, identifier)
            let relativeY = frame.minY - pageFrame.minY
            XCTAssertGreaterThan(relativeY, previousY, "Home order must remain visit, metrics")
            previousY = relativeY
            XCTAssertGreaterThanOrEqual(frame.minX, pageFrame.minX - 1)
            XCTAssertLessThanOrEqual(frame.maxX, pageFrame.maxX + 1)
            // XCTest attempts to reveal an offscreen target before the real activation.
            action.tap()
            if identifier == "home-metrics-edit" {
                XCTAssertTrue(app.staticTexts["지표를 2개에서 4개 선택하세요."].waitForAppearance())
                XCTAssertTrue(action.exists && action.isHittable, identifier)
                let homeScroll = UITestConditions.element(app, "navigation-route-scroll")
                XCTAssertTrue(homeScroll.waitForAppearance())
                for metric in ["sleep", "heartRate", "bodyMass", "steps"] {
                    let captureLandscapeSleepScroll = UITestConditions.shouldCaptureHomeScrollDiagnosticPair(for: metric)
                    UITestConditions.toggleCheckboxAndAssertState(
                        app, identifier: "home-metric-selection-\(metric)", in: homeScroll,
                        captureScrollDiagnosticPair: captureLandscapeSleepScroll,
                    )
                }
                UITestConditions.scrollToAndTap(UITestConditions.element(app, "home-metric-selection-cancel"), in: homeScroll)
            } else {
                NavigationUITestConditions.route(app, markers: ["appointment-preparation"])
                try NavigationUITestConditions.navigationAction(app, "navigation-back").control.tap()
                XCTAssertTrue(page.waitForAppearance())
                XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-home").control.isSelected)
            }
        }
        if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
            XCTAssertLessThanOrEqual(page.frame.maxX, navigation.toolbar.frame.minX + 1,
                                     "Home content must stay outside the measured right navigation lane")
        }
    }
}
