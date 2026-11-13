import XCTest

/// A synthetic native inbox tap targets a real protected saved reply; no OS notification delivery is claimed.
@MainActor
final class AssistantReplyEntryUITests: OrotFailFastTestCase {
    func testSavedReplyWaitsForAppearanceAndOpensAfterSave() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "assistant-reply-acceptance", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let star = app.descendants(matching: .any).matching(identifier: "별").firstMatch
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "rag-conversation-screen").exists)
        XCTAssertTrue(star.isHittable)
        XCTAssertGreaterThanOrEqual(star.frame.width, 44)
        XCTAssertGreaterThanOrEqual(star.frame.height, 44)
        star.tap()
        let save = app.buttons["저장"]
        XCTAssertNotNil(FormUITestConditions.reveal(save, in: app, scroll: app.scrollViews.firstMatch))
        XCTAssertTrue(save.isHittable && save.isEnabled)
        save.tap()

        let history = UITestConditions.element(app, "rag-conversation-history")
        let answer = app.staticTexts["Synthetic retained reply"]
        XCTAssertTrue(UITestConditions.exists(history), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(answer), app.debugDescription)
        XCTAssertTrue(answer.isHittable, answer.debugDescription)
        XCTAssertTrue(history.frame.contains(answer.frame), answer.debugDescription)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(UITestConditions.exists(answer), app.debugDescription)
        XCTAssertTrue(answer.isHittable, answer.debugDescription)
    }
}
