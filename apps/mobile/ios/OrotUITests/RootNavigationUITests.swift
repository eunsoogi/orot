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

    /// Keep the scheduled case in this suite while its fixture journey lives separately.
    @MainActor
    func testContextualBackRemainsAboveKeyboardAndDismissesIt() throws {
        try verifyContextualConversationKeyboard()
    }

    @MainActor
    func testBackRemainsReachableWithoutHomeButton() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-new-recording")
        try NavigationGeometryUITestConditions.captureRecordingBoundary(app, testCase: self)
        XCTAssertFalse(app.buttons["navigation-home"].exists)
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-back").control.isHittable)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
        capture(app, "records-after-back")
    }

    @MainActor
    func testRightRailKeepsAccessibleRootAndContextualNavigation() throws {
        let app = launch(["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"])
        defer { app.terminate() }
        let home = try NavigationUITestConditions.navigationAction(app, "navigation-tab-overview")
        XCTAssertTrue(home.control.isSelected)
        let rootFrame = try NavigationGeometryUITestConditions.verifyRootBoundaries(app, testCase: self)
        XCTAssertEqual(home.control.label, "한눈에 탭")
        XCTAssertEqual(home.toolbar.frame.width, 48, accuracy: 0.5)
        XCTAssertGreaterThan(home.toolbar.frame.height, home.toolbar.frame.width)
        XCTAssertGreaterThan(home.toolbar.frame.midX, app.frame.midX)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-records").control.isSelected)
        tap(app, "records-new-recording")
        let contextualFrame = try NavigationGeometryUITestConditions.captureRecordingBoundary(app, testCase: self)
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        // Compare native UIKit frames captured in the same UIWindow across route navigation.
        let contextualFrames = [contextualFrame, back.control.frame]
        NavigationGeometryUITestConditions.assertSameRailCenter(rootFrame, contextualFrames: contextualFrames)
        XCTAssertEqual(back.toolbar.frame.width, 48, accuracy: 0.5)
        XCTAssertEqual(back.control.label, "이전 화면으로 돌아가기")
        XCTAssertFalse(app.buttons["navigation-home"].exists)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
        capture(app, "accessible-right-navigation")
    }

    @MainActor
    func testLargeTextKeepsRootTabsAndRecordingActionsReachable() throws {
        let normal = launch()
        let normalTitleHeight = UITestConditions.element(normal, "overview-title").frame.height
        normal.terminate()
        let app = launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        defer { app.terminate() }
        // Observe the actual rendered enlargement, rather than treating the launch argument as proof of large text.
        XCTAssertGreaterThan(UITestConditions.element(app, "overview-title").frame.height, normalTitleHeight)
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        // At large text the metrics editor is above the scrolled viewport; confirm Home using its visible lower section.
        try NavigationUITestConditions.openTab(app, "overview", markers: ["overview-recent-changes"])
        _ = try NavigationUITestConditions.navigationAction(app, "navigation-tab-overview")
        capture(app, "home-xxxl-glass-tabs")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-new-recording")
        NavigationUITestConditions.route(app, markers: ["recording-controls-scroll"])
        try NavigationUITestConditions.scrollToBottom(app, "recording-controls-scroll")
        let microphone = UITestConditions.element(app, "recording-microphone-control")
        RecordingFixtureUITestConditions.prepareRecordingAction(app, microphone: microphone)
        XCTAssertTrue(microphone.exists && microphone.isHittable)
        capture(app, "recording-xxxl-navigation")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
    }

    @MainActor
    func launch(_ arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + arguments
        app.launch()
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        XCTAssertNoThrow(try NavigationUITestConditions.openTab(app, "overview", markers: ["overview-title"]))
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
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])
        let action = UITestConditions.element(app, "conversation-saved-visit-questions")
        FormUITestConditions.reveal(action, in: app, scrollID: "conversation-history-page", towardTop: true)
        XCTAssertTrue(action.isHittable, action.debugDescription)
        action.tap()
        let scroll = UITestConditions.element(app, "saved-visit-questions-screen")
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
        let title = app.staticTexts["saved-visit-questions-title"]
        XCTAssertTrue(title.exists && !title.frame.isEmpty)
        XCTAssertEqual(title.label, "저장된 진료 질문")
        XCTAssertGreaterThanOrEqual(title.frame.minY, scroll.frame.minY)
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back").control
        XCTAssertEqual(back.label, "이전 화면으로 돌아가기")
        // Context actions must not present themselves as the active root tab to accessibility clients.
        XCTAssertFalse(back.isSelected)
        XCTAssertFalse(app.buttons["navigation-home"].exists)
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
        let ai = UITestConditions.element(app, "conversation-history-screen")
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in ai.exists && ai.isHittable && !scroll.exists }, object: nil)
        let returnResult = UITestConditions.wait(for: [returned])
        // Preserve the failed ordering too: XCTest's assertion exception can bypass Swift defer.
        captureNavigationObservation(app, "after-return-wait")
        XCTAssertEqual(returnResult, .completed, app.debugDescription)
        captureNavigationObservation(app, "after-returned-route")
        capture(app, "edge-back-completed")
        FormUITestConditions.reveal(action, in: app, scrollID: "conversation-history-page", towardTop: true)
        action.tap()
        XCTAssertTrue(UITestConditions.exists(scroll))
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
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
