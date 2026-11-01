import XCTest

/// Exercises the fixed dock against the real keyboard using the synthetic conversation sender.
final class ConversationComposerDockUITests: OrotFailFastTestCase {
    @MainActor
    func testDockRemainsReachableAcrossConversationStates() {
        let app = XCUIApplication()
        let observationSession = UUID().uuidString
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-visual", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_CONVERSATION_HIT_OBSERVATION", observationSession, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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
        let baselineHeight = UITestConditions.element(app, "rag-conversation-composer-field").frame.height
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForAppearance())
        typeOnKeyboard("a\na\na", in: app)
        let multiline = input.value as? String
        XCTAssertEqual(multiline, "a\na\na")
        typeOnKeyboard("a", in: app)
        tapKey(app.keyboards.firstMatch.keys["delete"], in: app)
        XCTAssertEqual(input.value as? String, multiline)
        XCTAssertGreaterThan(UITestConditions.element(app, "rag-conversation-composer-field").frame.height, baselineHeight)
        XCTAssertTrue(send.isHittable)
        ConversationHitUITestObservation.assertDockGeometry(app, phase: "send-ready", session: observationSession, testCase: self)
        send.tap()
        let citation = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(citation))
        FormUITestConditions.reveal(citation, in: app, scroll: history)
        XCTAssertTrue(citation.isHittable)
        XCTAssertLessThanOrEqual(citation.frame.maxY, composer.frame.minY + 1)
        input.tap()
        typeOnKeyboard("pending", in: app)
        XCTAssertEqual(input.value as? String, "pending")
        XCTAssertTrue(send.isHittable)
        send.tap()
        let cancel = app.buttons.matching(identifier: "rag-conversation-cancel").firstMatch
        XCTAssertTrue(UITestConditions.exists(cancel))
        XCTAssertTrue(cancel.isHittable)
        ConversationHitUITestObservation.assertDockGeometry(app, phase: "cancel-ready", session: observationSession, testCase: self)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
        cancel.tap()
        input.tap()
        typeOnKeyboard("failure", in: app)
        XCTAssertTrue((input.value as? String)?.contains("failure") == true)
        XCTAssertTrue(send.isHittable)
        send.tap()
        let error = UITestConditions.element(app, "rag-conversation-error")
        XCTAssertTrue(UITestConditions.exists(error))
        XCTAssertTrue(input.isHittable)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
    }

    /// Exercise the visible software keyboard instead of injecting hardware-style text.
    @MainActor
    private func typeOnKeyboard(_ text: String, in app: XCUIApplication) {
        let keyboard = app.keyboards.firstMatch
        for character in text {
            let key = character == "\n" ? keyboard.buttons["Return"] : keyboard.keys[String(character)]
            tapKey(key, in: app)
        }
    }

    @MainActor
    private func tapKey(_ key: XCUIElement, in app: XCUIApplication) {
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.exists && key.exists && key.isHittable)
        XCTAssertTrue(keyboard.frame.contains(key.frame))
        key.tap()
    }
}

/// Verifies fixed controls against their dock and actual occluding system surfaces.
@MainActor
enum ConversationComposerDockUITestConditions {
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
