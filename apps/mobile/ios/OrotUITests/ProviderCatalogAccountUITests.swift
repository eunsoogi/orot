import XCTest

/// Checks the synthetic logged-out account card without authenticating a real account.
final class ProviderCatalogAccountUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testAccountActionStaysAccessibleAndCenteredWithLargeText() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "provider-selection",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer { app.terminate() }

        let syntheticLogin = UITestConditions.element(app, "provider-selection-auth-cancel")
        XCTAssertTrue(syntheticLogin.waitForAppearance(), app.debugDescription)
        syntheticLogin.tap()

        let screen = UITestConditions.element(app, "provider-selection-screen")
        let card = UITestConditions.element(app, "chatgpt-account-setup")
        let details = UITestConditions.element(app, "chatgpt-account-details")
        let action = UITestConditions.element(app, "chatgpt-account-action")
        XCTAssertTrue(action.waitForAppearance(), app.debugDescription)
        let ready = NSPredicate { _, _ in action.exists && action.isEnabled && !action.frame.isEmpty }
        XCTAssertEqual(UITestConditions.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)]), .completed, app.debugDescription)
        FormUITestConditions.reveal(action, in: app, scroll: screen)

        XCTAssertTrue(action.isHittable, app.debugDescription)
        XCTAssertEqual(action.elementType, .button)
        XCTAssertEqual(action.label, "ChatGPT 로그인")
        XCTAssertFalse(app.staticTexts["ChatGPT 로그인"].exists, app.debugDescription)
        XCTAssertGreaterThan(details.frame.height, 44, "Large account copy must grow naturally")
        XCTAssertGreaterThanOrEqual(action.frame.width, 44)
        XCTAssertGreaterThanOrEqual(action.frame.height, 44)
        // The fixed icon follows the full card center as Dynamic Type grows its explanation.
        XCTAssertEqual(action.frame.midY, card.frame.midY, accuracy: 1)
    }

    @MainActor
    func testLongKoreanPermissionGuidanceWrapsBeforeTheRefreshAction() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "provider-selection",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        defer { app.terminate() }

        let missingScope = UITestConditions.element(
            app,
            "provider-selection-account-missing-scope",
        )
        XCTAssertTrue(missingScope.waitForAppearance(), app.debugDescription)
        let ready = NSPredicate { _, _ in missingScope.exists && missingScope.isHittable }
        XCTAssertEqual(
            UITestConditions.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)]),
            .completed,
            app.debugDescription,
        )
        missingScope.tap()

        let screen = UITestConditions.element(app, "provider-selection-screen")
        let card = UITestConditions.element(app, "chatgpt-account-setup")
        let permission = UITestConditions.element(app, "chatgpt-account-permission-0")
        let action = UITestConditions.element(app, "chatgpt-account-action")
        XCTAssertTrue(permission.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(action.waitForAppearance(), app.debugDescription)
        FormUITestConditions.reveal(action, in: app, scroll: screen)

        XCTAssertTrue(action.isHittable, app.debugDescription)
        XCTAssertEqual(action.label, "ChatGPT 다시 로그인")
        XCTAssertEqual(
            permission.label,
            "ChatGPT 직접 사용 권한이 없어 다시 로그인해 권한을 확인해야 해요.",
        )
        XCTAssertFalse(app.staticTexts["ChatGPT 다시 로그인"].exists)
        XCTAssertGreaterThan(permission.frame.height, 44, "Long Korean permission copy must wrap at large text")
        XCTAssertLessThanOrEqual(permission.frame.maxX, action.frame.minX)
        XCTAssertFalse(permission.frame.intersects(action.frame))
        XCTAssertGreaterThanOrEqual(action.frame.width, 44)
        XCTAssertGreaterThanOrEqual(action.frame.height, 44)
        XCTAssertEqual(action.frame.midY, card.frame.midY, accuracy: 1)
    }
}
