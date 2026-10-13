import XCTest

final class RootNavigationUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testEveryRootTabAndNativeRecordingNavigationRemainReachable() throws {
        let app = launch()
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
            let action = try NavigationUITestConditions.nativeAction(app, "navigation-tab-\(tab)")
            XCTAssertEqual(action.control.label, label)
            capture(app, "selected-root-tab-\(tab)")
        }
        try NavigationUITestConditions.openTab(app, "home", markers: ["welcome-title"])
        let recent = UITestConditions.element(app, "home-open-records")
        let bar = try NavigationUITestConditions.nativeAction(app, "navigation-tab-home").toolbar
        let root = UITestConditions.element(app, "navigation-keyboard-avoiding-root")
        XCTAssertTrue(recent.exists && !recent.frame.isEmpty)
        XCTAssertTrue(root.exists && !root.frame.isEmpty)
        XCTAssertLessThanOrEqual(recent.frame.maxY, bar.frame.minY)
        XCTAssertLessThanOrEqual(root.frame.maxY - bar.frame.maxY, 34)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-new-recording")
        NavigationUITestConditions.route(app, markers: ["recording-controls-scroll"])
        XCTAssertEqual(try NavigationUITestConditions.nativeAction(app, "navigation-home").control.label, "홈 화면으로 이동")
        try NavigationUITestConditions.tapNative(app, "navigation-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        capture(app, "home-after-native-home-action")
    }

    @MainActor
    func testSettingsKeepsAccountsBackupAndPrivacyOnTheirOwnRoutes() throws {
        let app = launch()
        defer { app.terminate() }
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        for identifier in ["settings-open-provider", "settings-open-accounts", "settings-open-privacy", "settings-open-backup"] {
            let control = UITestConditions.element(app, identifier)
            XCTAssertTrue(control.exists && control.isHittable)
        }
        capture(app, "settings-root-light")
        tap(app, "settings-open-accounts")
        NavigationUITestConditions.route(app, markers: ["settings-accounts-screen"])
        XCTAssertTrue(app.staticTexts["연결된 계정"].exists)
        XCTAssertTrue(UITestConditions.element(app, "chatgpt-account-setup").exists)
        try backToSettings(app)
        tap(app, "settings-open-backup")
        NavigationUITestConditions.route(app, markers: ["settings-backup-title"])
        XCTAssertTrue(UITestConditions.element(app, "backup-status-message").isHittable)
        XCTAssertTrue(UITestConditions.element(app, "backup-prepare").isHittable)
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "settings-backup-scroll", contentID: "backup-open-system-settings")
        XCTAssertTrue(UITestConditions.element(app, "backup-open-system-settings").isHittable)
        capture(app, "settings-backup-light")
        try backToSettings(app)
        tap(app, "settings-open-privacy")
        NavigationUITestConditions.route(app, markers: ["settings-privacy-title"])
        for title in ["마이크", "음성 인식", "건강 앱", "캘린더"] {
            XCTAssertTrue(app.staticTexts[title].exists)
        }
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "settings-privacy-scroll", contentID: "privacy-open-system-settings")
        XCTAssertTrue(UITestConditions.element(app, "privacy-open-system-settings").isHittable)
        capture(app, "settings-privacy-light")
        try backToSettings(app)
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
        _ = try NavigationUITestConditions.nativeAction(app, "navigation-tab-home")
        capture(app, "home-xxxl-native-glass-tabs")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-new-recording")
        NavigationUITestConditions.route(app, markers: ["recording-controls-scroll"])
        try NavigationUITestConditions.scrollToBottom(app, "recording-controls-scroll")
        let start = UITestConditions.element(app, "recording-start")
        XCTAssertTrue(start.exists && start.isHittable)
        capture(app, "recording-xxxl-native-navigation")
        try NavigationUITestConditions.tapNative(app, "navigation-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
    }

    @MainActor
    private func launch(_ arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + arguments
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        return app
    }

    @MainActor
    func testAiFeatureSafeAreaNativeActionsAndCancelledThenCompletedEdgeBack() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_TEST_UI_GEOMETRY", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "welcome-title")))
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
        XCTAssertEqual(try NavigationUITestConditions.nativeAction(app, "navigation-back").control.label, "이전 화면으로 돌아가기")
        XCTAssertEqual(try NavigationUITestConditions.nativeAction(app, "navigation-home").control.label, "홈 화면으로 이동")
        capture(app, "visit-questions-native-safe-area")
        edgeBack(scroll, in: app, fraction: 0.08, velocity: XCUIGestureVelocity(rawValue: 80))
        XCTAssertTrue(scroll.exists && scroll.isHittable)
        capture(app, "edge-back-cancelled")
        edgeBack(scroll, in: app, fraction: 0.85, velocity: .fast)
        let ai = UITestConditions.element(app, "ai-features-screen")
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in ai.exists && ai.isHittable && !scroll.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 30), .completed, app.debugDescription)
        capture(app, "edge-back-completed")
        FormUITestConditions.reveal(action, in: app, scrollID: "ai-features-screen", towardTop: true)
        action.tap()
        XCTAssertTrue(UITestConditions.exists(scroll))
        try NavigationUITestConditions.tapNative(app, "navigation-home")
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
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
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let element = UITestConditions.element(app, identifier)
        XCTAssertTrue(element.waitForExistence(timeout: 30))
        UITestConditions.scrollTo(element, in: app)
        element.tap()
    }

    @MainActor
    private func backToSettings(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.tapNative(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
