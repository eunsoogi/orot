import XCTest

/// Verifies the saved assistant appearance through a real app restart and protected store.
@MainActor
final class AssistantAppearanceUITests: OrotFailFastTestCase {
    func testRequiredAppearanceNameKeyboardAndRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "assistant-acceptance", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }

        let star = app.descendants(matching: .any).matching(identifier: "별").firstMatch
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        star.tap()
        let name = app.textFields["비서 이름"]
        XCTAssertTrue(name.isHittable)
        name.tap()
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        name.typeText("Momo")
        let save = app.buttons["assistant-appearance-save"]
        guard FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll") != nil else { return }
        XCTAssertTrue(save.isHittable && save.isEnabled)
        save.tap()
        let ai = UITestConditions.element(app, "navigation-tab-conversation")
        XCTAssertTrue(UITestConditions.exists(ai), app.debugDescription)
        app.terminate()
        app.launch()
        XCTAssertTrue(UITestConditions.exists(ai), app.debugDescription)
        ai.tap()
        let identity = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "비서 꾸미기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(identity), app.debugDescription)
        XCTAssertEqual(identity.label, "Momo, 비서 꾸미기")
        identity.tap()
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        XCTAssertTrue((star.value as? String)?.contains("checked") == true, star.debugDescription)
        XCTAssertFalse((star.value as? String)?.contains("unchecked") == true, star.debugDescription)
        XCTAssertEqual(name.value as? String, "Momo")
    }
}
