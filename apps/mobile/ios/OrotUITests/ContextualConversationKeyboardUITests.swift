import XCTest

extension RootNavigationUITests {
    @MainActor
    func verifyContextualConversationKeyboard() throws {
        let app = XCUIApplication()
        // The opt-in fixture enters the real contextual conversation through Home without running a model.
        app.launchArguments = ["-OROT_E2E_PROBE", "medical-appointment-app-navigation", "-OROT_HOME_CONVERSATION_VISIT", "YES", "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(UITestConditions.element(app, "welcome-title").waitForAppearance())
        let prepare = UITestConditions.element(app, "home-prepare-visit")
        XCTAssertTrue(prepare.waitForAppearance(), app.debugDescription)
        FormUITestConditions.reveal(prepare, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(prepare.isHittable, prepare.debugDescription)
        prepare.tap()
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(input.waitForAppearance())
        // The composer is docked below the history, so scrolling history cannot reveal its input.
        ConversationComposerDockUITestConditions.assertReachable(input, in: app)
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
}
