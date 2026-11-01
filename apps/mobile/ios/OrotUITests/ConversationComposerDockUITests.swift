import XCTest

/// Exercises the fixed dock against the real keyboard using the synthetic conversation sender.
final class ConversationComposerDockUITests: OrotFailFastTestCase {
    @MainActor
    func testDockRemainsReachableAcrossConversationStates() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let history = UITestConditions.element(app, "rag-conversation-history")
        let composer = UITestConditions.element(app, "rag-conversation-composer")
        let input = UITestConditions.element(app, "rag-conversation-input")
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        XCTAssertTrue(UITestConditions.exists(history))
        XCTAssertTrue(UITestConditions.exists(composer))
        XCTAssertTrue(input.isHittable)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForAppearance())
        input.typeText("complete synthetic\nsecond line\nthird line")
        XCTAssertTrue(send.isHittable)
        ConversationComposerDockUITestConditions.waitForKeyboardClearance(composer, in: app)
        XCTAssertLessThanOrEqual(composer.frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
        send.tap()
        let citation = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(citation))
        FormUITestConditions.reveal(citation, in: app, scroll: history)
        XCTAssertTrue(citation.isHittable)
        XCTAssertLessThanOrEqual(citation.frame.maxY, composer.frame.minY + 1)
        input.tap()
        input.typeText("pending synthetic")
        XCTAssertTrue(send.isHittable)
        send.tap()
        let cancel = app.buttons.matching(identifier: "rag-conversation-cancel").firstMatch
        XCTAssertTrue(UITestConditions.exists(cancel))
        XCTAssertTrue(cancel.isHittable)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
        cancel.tap()
        input.tap()
        input.typeText("failure synthetic")
        XCTAssertTrue(send.isHittable)
        send.tap()
        let error = UITestConditions.element(app, "rag-conversation-error")
        XCTAssertTrue(UITestConditions.exists(error))
        XCTAssertTrue(input.isHittable)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
    }
}

/// Verifies fixed controls against their dock and actual occluding system surfaces.
@MainActor
enum ConversationComposerDockUITestConditions {
    /// Observe the actual keyboard boundary after its layout changes, without substituting a delay.
    static func waitForKeyboardClearance(_ dock: XCUIElement, in app: XCUIApplication) {
        let keyboard = app.keyboards.firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            dock.exists && keyboard.exists && dock.frame.maxY <= keyboard.frame.minY + 1
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
    }

    /// Rotation is ready for the next action only when the actual control is inside the window and hittable.
    static func waitForWindowControl(_ control: XCUIElement, in app: XCUIApplication) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            control.exists && control.isHittable && app.frame.contains(control.frame)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
    }

    /// The stream must retain a readable line inside the real scroll viewport.
    static func assertStreamVisible(in app: XCUIApplication) {
        let history = UITestConditions.element(app, "rag-conversation-history")
        let stream = UITestConditions.element(app, "rag-conversation-stream")
        XCTAssertTrue(UITestConditions.exists(history))
        XCTAssertTrue(UITestConditions.exists(stream))
        let visible = history.frame.intersection(stream.frame)
        XCTAssertFalse(visible.isNull)
        XCTAssertGreaterThanOrEqual(visible.height, min(24, stream.frame.height))
    }

    static func assertReachable(_ control: XCUIElement, in app: XCUIApplication) {
        let dock = UITestConditions.element(app, "rag-conversation-composer")
        let history = UITestConditions.element(app, "rag-conversation-history")
        XCTAssertTrue(UITestConditions.exists(control))
        XCTAssertTrue(UITestConditions.exists(dock))
        XCTAssertTrue(control.isHittable, control.debugDescription)
        XCTAssertTrue(dock.frame.contains(control.frame), "Control: \(control.frame), dock: \(dock.frame)")
        XCTAssertLessThanOrEqual(history.frame.maxY, control.frame.minY + 1)
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            XCTAssertLessThanOrEqual(control.frame.maxY, keyboard.frame.minY + 1)
        }
        let back = UITestConditions.element(app, "navigation-back")
        if back.exists {
            XCTAssertFalse(control.frame.intersects(back.frame))
        }
    }
}
