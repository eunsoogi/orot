import XCTest

final class RootNavigationUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Keep the scheduled XCTest entry in its suite file; the Settings journey shares navigation helpers.
    @MainActor
    func testSettingsKeepsAccountsBackupAndPrivacyOnTheirOwnRoutes() throws {
        try verifySettingsRoutes()
    }

    @MainActor
    func testEveryRootTabAndRecordingNavigationRemainReachable() throws {
        let app = launch(["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"])
        defer { app.terminate() }
        let tabs = [
            ("home", ["welcome-title"], "홈 탭"),
            ("records", ["records-title"], "기록 탭"),
            ("schedule", ["calendar-title", "schedule-retry"], "일정 탭"),
            ("ai", ["ai-features-screen"], "AI 탭"),
            ("settings", ["settings-title"], "설정 탭"),
        ]
        for (tab, markers, label) in tabs {
            try NavigationUITestConditions.openTab(app, tab, markers: markers)
            let action = try NavigationUITestConditions.navigationAction(app, "navigation-tab-\(tab)")
            XCTAssertEqual(action.control.label, label)
            // Read the native accessibility selection state in addition to the rendered route.
            XCTAssertTrue(action.control.isSelected, "Root tab \(tab) must expose selected state")
            try NavigationGeometryUITestConditions.captureBoundary(app, navigationID: "navigation-tab-\(tab)", name: "selected-root-tab-\(tab)", testCase: self)
        }
        try NavigationUITestConditions.openTab(app, "home", markers: ["welcome-title"])
        let recent = UITestConditions.element(app, "home-open-records")
        let bar = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home").toolbar
        let root = UITestConditions.element(app, "navigation-keyboard-avoiding-root")
        XCTAssertTrue(recent.exists && !recent.frame.isEmpty)
        XCTAssertTrue(root.exists && !root.frame.isEmpty)
        XCTAssertLessThanOrEqual(recent.frame.maxY, bar.frame.minY)
        // Preserve the original root-tab clearance bound using the live native bar frame.
        let bottomClearance = root.frame.maxY - bar.frame.maxY
        XCTAssertGreaterThanOrEqual(bottomClearance, 22)
        XCTAssertLessThanOrEqual(bottomClearance, 26)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-new-recording")
        try NavigationGeometryUITestConditions.captureRecordingBoundary(app, testCase: self)
        XCTAssertEqual(try NavigationUITestConditions.navigationAction(app, "navigation-home").control.label, "홈 화면으로 이동")
        try NavigationUITestConditions.tapNavigation(app, "navigation-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        capture(app, "home-after-home-action")
    }

    @MainActor
    func testRightRailKeepsAccessibleRootAndContextualNavigation() throws {
        let app = launch(["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"])
        defer { app.terminate() }
        let home = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        XCTAssertTrue(home.control.isSelected)
        let rootFrame = try NavigationGeometryUITestConditions.verifyRootBoundaries(app, testCase: self)
        XCTAssertEqual(home.control.label, "홈 탭")
        XCTAssertEqual(home.toolbar.frame.width, 48, accuracy: 0.5)
        XCTAssertGreaterThan(home.toolbar.frame.height, home.toolbar.frame.width)
        XCTAssertGreaterThan(home.toolbar.frame.midX, app.frame.midX)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-records").control.isSelected)
        tap(app, "records-new-recording")
        let contextualFrame = try NavigationGeometryUITestConditions.captureRecordingBoundary(app, testCase: self)
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        let homeAction = try NavigationUITestConditions.navigationAction(app, "navigation-home")
        // Compare native UIKit frames captured in the same UIWindow across route navigation.
        let contextualFrames = [contextualFrame, back.control.frame, homeAction.control.frame]
        NavigationGeometryUITestConditions.assertSameRailCenter(rootFrame, contextualFrames: contextualFrames)
        XCTAssertEqual(back.toolbar.frame.width, 48, accuracy: 0.5)
        XCTAssertEqual(homeAction.control.frame.width, 48, accuracy: 0.5)
        XCTAssertGreaterThan(homeAction.control.frame.midY, back.control.frame.midY)
        XCTAssertEqual(back.control.label, "이전 화면으로 돌아가기")
        XCTAssertEqual(homeAction.control.label, "홈 화면으로 이동")
        try NavigationUITestConditions.tapNavigation(app, "navigation-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        capture(app, "accessible-right-navigation")
    }

    @MainActor
    func testLargeTextKeepsRootTabsAndRecordingActionsReachable() throws {
        let normal = launch()
        let normalTitleHeight = UITestConditions.element(normal, "welcome-title").frame.height
        normal.terminate()
        let app = launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        defer { app.terminate() }
        // Observe the actual rendered enlargement, rather than treating the launch argument as proof of large text.
        XCTAssertGreaterThan(UITestConditions.element(app, "welcome-title").frame.height, normalTitleHeight)
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        try NavigationUITestConditions.openTab(app, "home", markers: ["home-empty-recordings", "home-recordings-retry"])
        _ = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home")
        capture(app, "home-xxxl-glass-tabs")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-new-recording")
        NavigationUITestConditions.route(app, markers: ["recording-controls-scroll"])
        try NavigationUITestConditions.scrollToBottom(app, "recording-controls-scroll")
        let microphone = UITestConditions.element(app, "recording-microphone-control")
        XCTAssertTrue(microphone.exists && microphone.isHittable)
        capture(app, "recording-xxxl-navigation")
        try NavigationUITestConditions.tapNavigation(app, "navigation-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
    }

    @MainActor
    func launch(_ arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + arguments
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        return app
    }

    @MainActor
    func testAiFeatureSafeAreaActionsAndCancelledThenCompletedEdgeBack() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer {
            captureNavigationObservation(app, "final-edge-back-observation")
            app.terminate()
        }
        // This React Native text header has a native StaticText trait; use its typed XCTest query on startup.
        let welcomeTitle = app.staticTexts.matching(identifier: "welcome-title").firstMatch
        XCTAssertTrue(UITestConditions.exists(welcomeTitle))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        let action = UITestConditions.element(app, "ai-feature-visit-questions")
        FormUITestConditions.reveal(action, in: app, scrollID: "ai-features-screen", towardTop: true)
        action.tap()
        let scroll = UITestConditions.element(app, "next-visit-questions-scroll")
        XCTAssertTrue(UITestConditions.exists(scroll))
        let observed = try NavigationUITestConditions.safeArea(app, testCase: self)
        let roots = app.descendants(matching: .any).matching(identifier: "navigation-keyboard-avoiding-root").allElementsBoundByIndex
        let root = try XCTUnwrap(roots.first { $0.frame.contains(scroll.frame) && $0.frame.intersects(observed.frame) })
        // The native listener must measure this full route root, not a different viewport or a guessed device constant.
        XCTAssertEqual(root.frame.minX, observed.frame.minX, accuracy: 0.5)
        XCTAssertEqual(root.frame.minY, observed.frame.minY, accuracy: 0.5)
        XCTAssertEqual(root.frame.width, observed.frame.width, accuracy: 0.5)
        XCTAssertEqual(root.frame.height, observed.frame.height, accuracy: 0.5)
        XCTAssertGreaterThan(observed.top, 0)
        XCTAssertGreaterThanOrEqual(scroll.frame.minY - root.frame.minY, observed.top)
        let title = UITestConditions.element(app, "next-visit-title")
        XCTAssertTrue(title.exists && !title.frame.isEmpty)
        XCTAssertGreaterThanOrEqual(title.frame.minY, scroll.frame.minY)
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back").control
        let home = try NavigationUITestConditions.navigationAction(app, "navigation-home").control
        XCTAssertEqual(back.label, "이전 화면으로 돌아가기")
        XCTAssertEqual(home.label, "홈 화면으로 이동")
        // Context actions must not present themselves as the active root tab to accessibility clients.
        XCTAssertFalse(back.isSelected)
        XCTAssertFalse(home.isSelected)
        capture(app, "visit-questions-safe-area")
        captureNavigationObservation(app, "before-edge-back")
        edgeBack(scroll, in: app, fraction: 0.08, velocity: XCUIGestureVelocity(rawValue: 80))
        XCTAssertTrue(scroll.exists && scroll.isHittable)
        capture(app, "edge-back-cancelled")
        captureNavigationObservation(app, "after-cancelled-edge-back")
        // Local UIKit diagnostics sometimes cancelled at an 86% endpoint and returned at a 99% endpoint.
        // Send the intended completion path near the far edge; existing route assertions still decide success.
        edgeBack(scroll, in: app, fraction: 0.98, velocity: .fast)
        captureNavigationObservation(app, "after-full-edge-back")
        let ai = UITestConditions.element(app, "ai-features-screen")
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in ai.exists && ai.isHittable && !scroll.exists }, object: nil)
        let returnResult = UITestConditions.wait(for: [returned])
        // Preserve the failed ordering too: XCTest's assertion exception can bypass Swift defer.
        captureNavigationObservation(app, "after-return-wait")
        XCTAssertEqual(returnResult, .completed, app.debugDescription)
        captureNavigationObservation(app, "after-returned-route")
        capture(app, "edge-back-completed")
        FormUITestConditions.reveal(action, in: app, scrollID: "ai-features-screen", towardTop: true)
        action.tap()
        XCTAssertTrue(UITestConditions.exists(scroll))
        try NavigationUITestConditions.tapNavigation(app, "navigation-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
    }

    @MainActor
    func testContextualNavigationRemainsAboveKeyboardAndHomeDismissesIt() throws {
        let app = launch(["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"])
        defer { app.terminate() }
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        tap(app, "ai-feature-rag-conversation")
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(input.waitForAppearance())
        FormUITestConditions.reveal(input, in: app, scrollID: "rag-conversation-history")
        input.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(UITestConditions.exists(keyboard), app.debugDescription)
        XCTAssertGreaterThan(keyboard.frame.height, 100)
        try NavigationUITestConditions.assertSharedViewport(app, keyboard: keyboard, testCase: self)
        for identifier in ["navigation-back", "navigation-home"] {
            let action = try NavigationUITestConditions.navigationAction(app, identifier)
            XCTAssertLessThanOrEqual(action.control.frame.maxY, keyboard.frame.minY + 1, "\(identifier) must remain above the keyboard")
        }
        try NavigationGeometryUITestConditions.captureBoundary(app, navigationID: "navigation-back", name: "conversation-keyboard-native-navigation", testCase: self, requireCurrentNavigation: true)
        try NavigationUITestConditions.tapNavigation(app, "navigation-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        let keyboardDismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !keyboard.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [keyboardDismissed]), .completed, app.debugDescription)
        try NavigationUITestConditions.assertSharedViewport(app, testCase: self)
        try NavigationGeometryUITestConditions.captureBoundary(app, navigationID: "navigation-tab-home", name: "home-after-keyboard-navigation", testCase: self)
    }

    @MainActor
    private func captureNavigationObservation(_ app: XCUIApplication, _ name: String) {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let data = Data(UITestConditions.text(marker).utf8)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func edgeBack(_ scroll: XCUIElement, in app: XCUIApplication, fraction: CGFloat, velocity: XCUIGestureVelocity) {
        let frame = scroll.frame
        XCTAssertFalse(frame.isEmpty)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: frame.minX + frame.width * 0.01, dy: frame.midY))
        let end = origin.withOffset(CGVector(dx: frame.minX + frame.width * (0.01 + fraction), dy: frame.midY))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0)
    }

    @MainActor
    func tap(_ app: XCUIApplication, _ identifier: String) {
        // These actions are buttons. A typed, unique query avoids the remote first-match walk through unrelated
        // containers and text nodes; it still resolves the live control again after every route change.
        let element = app.buttons[identifier]
        XCTAssertTrue(element.waitForAppearance())
        UITestConditions.scrollTo(element, in: app)
        element.tap()
    }

    @MainActor
    func backToSettings(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
    }

    @MainActor
    func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
