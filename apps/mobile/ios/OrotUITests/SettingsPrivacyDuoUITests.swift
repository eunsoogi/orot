import XCTest

final class SettingsPrivacyDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Verifies the real privacy route, explicit receipt action, and measured Duo content lane.
    @MainActor
    func testConsentConfirmationAndClearedStateSurviveDuoReflow() throws {
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        defer {
            XCUIDevice.shared.orientation = originalOrientation
            UITestConditions.terminateStandaloneApp(app)
        }
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()

        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        let privacyEntry = UITestConditions.element(app, "settings-open-privacy")
        UITestConditions.scrollTo(privacyEntry, in: app)
        privacyEntry.tap()
        NavigationUITestConditions.route(app, markers: ["settings-privacy-title"])

        for title in ["마이크", "음성 인식", "건강 앱", "캘린더"] {
            XCTAssertTrue(app.staticTexts[title].exists)
        }
        XCTAssertEqual(app.switches.count, 0, "Permission rows describe iOS-owned controls")
        try verifyPrivacyPanels(app)

        let clear = UITestConditions.element(app, "inference-consent-clear")
        UITestConditions.scrollTo(clear, in: app)
        XCTAssertTrue(clear.exists && clear.isHittable)
        let initialWidth = app.windows.firstMatch.frame.width
        clear.tap()

        let confirmation = app.alerts["외부 전송 동의 내역을 지울까요?"]
        XCTAssertTrue(UITestConditions.exists(confirmation), app.debugDescription)
        XCTAssertTrue(confirmation.staticTexts[
            "저장된 동의 내역을 지우고 진행 중인 자동 승인을 무효화해요. 진료 기록이나 다른 앱 자료는 삭제되지 않아요. 다음 전송 때 다시 확인해요.",
        ].exists)

        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWindowWidthChange(app, from: initialWidth)
        try verifyPrivacyPanels(app)
        XCTAssertTrue(confirmation.exists, "The explicit choice must remain open during reflow")
        confirmation.buttons["취소"].tap()
        XCTAssertTrue(clear.exists && clear.isEnabled)
        XCTAssertFalse(UITestConditions.element(app, "inference-consent-cleared").exists)

        UITestConditions.scrollTo(clear, in: app)
        XCTAssertTrue(clear.isHittable, "The clear action must remain reachable after reflow")
        clear.tap()
        let secondConfirmation = app.alerts["외부 전송 동의 내역을 지울까요?"]
        XCTAssertTrue(UITestConditions.exists(secondConfirmation), app.debugDescription)
        secondConfirmation.buttons["동의 내역 지우기"].tap()

        let cleared = UITestConditions.element(app, "inference-consent-cleared")
        let clearCompleted = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in cleared.exists && clear.isEnabled },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [clearCompleted]), .completed, app.debugDescription)

        let landscapeWidth = app.windows.firstMatch.frame.width
        XCUIDevice.shared.orientation = .portrait
        waitForWindowWidthChange(app, from: landscapeWidth)
        try verifyPrivacyPanels(app)
        XCTAssertTrue(cleared.exists, "The completed receipt state must survive reflow")
    }

    /// Checks horizontal viewport containment while allowing vertical scroll overflow.
    @MainActor
    private func verifyPrivacyPanels(_ app: XCUIApplication) throws {
        let scroll = UITestConditions.element(app, "settings-privacy-scroll")
        let columns = UITestConditions.element(app, "settings-privacy-columns")
        let primary = UITestConditions.element(app, "settings-privacy-permissions")
        let secondary = UITestConditions.element(app, "settings-privacy-external-transfer")
        XCTAssertTrue(UITestConditions.exists(scroll))
        XCTAssertTrue(UITestConditions.exists(columns))
        XCTAssertTrue(UITestConditions.exists(primary))
        XCTAssertTrue(UITestConditions.exists(secondary))

        let contentFrame = columns.frame
        let primaryFrame = primary.frame
        let secondaryFrame = secondary.frame
        XCTAssertGreaterThanOrEqual(contentFrame.minX, scroll.frame.minX - 1)
        XCTAssertLessThanOrEqual(contentFrame.maxX, scroll.frame.maxX + 1)
        XCTAssertTrue(contentFrame.contains(primaryFrame))
        XCTAssertTrue(contentFrame.contains(secondaryFrame))
        let stacked = abs(primaryFrame.minX - secondaryFrame.minX) <= 1 &&
            primaryFrame.maxY <= secondaryFrame.minY + 1
        XCTAssertTrue(stacked, "Permission and transfer sections must share one vertical page")

        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings")
        XCTAssertTrue(navigation.control.isSelected)
        XCTAssertGreaterThan(navigation.toolbar.frame.height, navigation.toolbar.frame.width)
        XCTAssertLessThanOrEqual(
            max(primaryFrame.maxX, secondaryFrame.maxX),
            navigation.toolbar.frame.minX + 1,
            "Privacy content must stay clear of the measured right navigation lane",
        )
    }

    @MainActor
    private func waitForWindowWidthChange(_ app: XCUIApplication, from width: CGFloat) {
        let changed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in abs(app.windows.firstMatch.frame.width - width) > 1 },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed, app.debugDescription)
    }
}
