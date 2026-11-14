import XCTest

/// Exercises the fixed dock against the real keyboard using the synthetic conversation sender.
final class ConversationComposerDockUITests: OrotFailFastTestCase {
    /// Verifies the available Duo layout with the software keyboard and live Send and Stop actions.
    @MainActor
    func testDuoComposerAndActionsRemainReachable() {
        let app = XCUIApplication()
        let observationSession = UUID().uuidString
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-visual", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_CONVERSATION_HIT_OBSERVATION", observationSession, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let input = UITestConditions.element(app, "rag-conversation-input")
        assertComposerGlassMatchesField(in: app)
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        input.tap()
        input.typeText("pending")
        XCTAssertEqual(input.value as? String, "pending")
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        XCTAssertTrue(send.isHittable)
        ConversationHitUITestObservation.assertDockGeometry(app, phase: "send-ready", session: observationSession, testCase: self)
        send.tap()
        let cancel = app.buttons.matching(identifier: "rag-conversation-cancel").firstMatch
        XCTAssertTrue(UITestConditions.exists(cancel) && cancel.isHittable)
        ConversationHitUITestObservation.assertDockGeometry(app, phase: "cancel-ready", session: observationSession, testCase: self)
        cancel.tap()
        XCTAssertTrue(UITestConditions.exists(send) && send.isHittable)
    }

    /// Checks failure recovery from a fresh conversation without relying on a prior scroll position.
    @MainActor
    func testFailureKeepsComposerReachable() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-failure-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let input = UITestConditions.element(app, "rag-conversation-input")
        let history = UITestConditions.element(app, "rag-conversation-history")
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        input.tap()
        input.typeText("a")
        XCTAssertEqual(input.value as? String, "a")
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        XCTAssertTrue(send.isHittable)
        send.tap()
        let error = UITestConditions.element(app, "rag-conversation-error")
        XCTAssertTrue(UITestConditions.exists(error))
        FormUITestConditions.reveal(error, in: app, scroll: history, requireHittable: false)
        XCTAssertTrue(error.exists)
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        ConversationComposerDockUITestConditions.assertReachable(input, in: app)
        ConversationComposerDockUITestConditions.assertReachable(send, in: app)
    }

    /// A compact history selection returns to the conversation before its page action is used.
    @MainActor
    func testCompactHistorySelectionReturnsToConversation() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        input.tap()
        input.typeText("history selection")
        app.buttons.matching(identifier: "rag-conversation-send").firstMatch.tap()
        let citation = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(citation))
        // Compact session controls scroll with the header; they are not native dock or overflow actions.
        let sessions = app.buttons.matching(identifier: "rag-conversation-sessions-toggle").firstMatch
        guard FormUITestConditions.reveal(sessions, in: app, scrollID: "rag-conversation-history", towardTop: true) != nil else { return }
        sessions.tap()
        let history = UITestConditions.element(app, "conversation-history-screen")
        let row = UITestConditions.element(app, "conversation-history-session-1")
        XCTAssertTrue(UITestConditions.exists(history) && UITestConditions.exists(row))
        XCTAssertGreaterThan(app.frame.height, app.frame.width)
        XCTAssertFalse(UITestConditions.element(app, "conversation-history-preview").exists)
        XCTAssertTrue(row.isHittable)
        row.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")))
        XCTAssertFalse(history.exists)
        let newSession = app.buttons.matching(identifier: "rag-conversation-new-session").firstMatch
        guard FormUITestConditions.reveal(newSession, in: app, scrollID: "rag-conversation-history", towardTop: true) != nil else { return }
        newSession.tap()
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        XCTAssertFalse(citation.exists)
    }

    @MainActor
    func testDockRemainsReachableAcrossConversationStates() throws {
        let app = XCUIApplication()
        let observationSession = UUID().uuidString
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-visual", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_CONVERSATION_HIT_OBSERVATION", observationSession, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchArguments += AppearanceUITestConditions.observationArguments
        app.launch()
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let originalAppearance {
                do {
                    try AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self)
                } catch {
                    XCTFail("Could not restore the owned device appearance: \(error)")
                }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        let history = UITestConditions.element(app, "rag-conversation-history")
        let composer = UITestConditions.element(app, "rag-conversation-composer")
        assertComposerGlassMatchesField(in: app)
        let input = UITestConditions.element(app, "rag-conversation-input")
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        XCTAssertTrue(UITestConditions.exists(history))
        XCTAssertTrue(UITestConditions.exists(composer))
        XCTAssertTrue(input.isHittable)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
        _ = try AppearanceUITestConditions.select(
            false,
            returningTo: app,
            testCase: self,
            captureOriginal: { originalAppearance = $0 },
        )
        assertComposerGlassMatchesField(in: app)
        let lightCapture = XCTAttachment(screenshot: app.screenshot())
        lightCapture.name = "conversation-composer-glass-light"
        lightCapture.lifetime = .keepAlways
        add(lightCapture)
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        assertComposerGlassMatchesField(in: app)
        let darkCapture = XCTAttachment(screenshot: app.screenshot())
        darkCapture.name = "conversation-composer-glass-dark"
        darkCapture.lifetime = .keepAlways
        add(darkCapture)
        let baselineHeight = UITestConditions.element(app, "rag-conversation-composer-field").frame.height
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForAppearance())
        typeOnKeyboard("a\na\na", in: app)
        let multiline = input.value as? String
        XCTAssertEqual(multiline?.lowercased(), "a\na\na")
        typeOnKeyboard("a", in: app)
        tapKey(app.keyboards.firstMatch.keys["delete"], in: app)
        XCTAssertEqual(input.value as? String, multiline)
        assertComposerGlassMatchesField(in: app)
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
        typeOnKeyboard("apending", in: app)
        XCTAssertEqual((input.value as? String)?.lowercased(), "apending")
        XCTAssertTrue(send.isHittable)
        send.tap()
        let cancel = app.buttons.matching(identifier: "rag-conversation-cancel").firstMatch
        XCTAssertTrue(UITestConditions.exists(cancel))
        XCTAssertTrue(cancel.isHittable)
        ConversationHitUITestObservation.assertDockGeometry(app, phase: "cancel-ready", session: observationSession, testCase: self)
        XCTAssertLessThanOrEqual(history.frame.maxY, composer.frame.minY + 1)
        cancel.tap()
        input.tap()
        typeOnKeyboard("afailure", in: app)
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
            // The system changes key labels with auto-capitalization; select the visible letter in either state.
            let key = character == "\n" ? keyboard.buttons["Return"] : keyboard.keys.matching(NSPredicate(format: "label ==[c] %@", String(character))).firstMatch
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

    /// Confirms the passive native material view covers the rounded field at its current height.
    @MainActor
    private func assertComposerGlassMatchesField(in app: XCUIApplication) {
        let field = UITestConditions.element(app, "rag-conversation-composer-field")
        let glass = UITestConditions.element(app, "rag-conversation-composer-glass")
        XCTAssertTrue(UITestConditions.exists(field) && UITestConditions.exists(glass), app.debugDescription)
        XCTAssertEqual(glass.frame.minX, field.frame.minX, accuracy: 1)
        XCTAssertEqual(glass.frame.minY, field.frame.minY, accuracy: 1)
        XCTAssertEqual(glass.frame.width, field.frame.width, accuracy: 1)
        XCTAssertEqual(glass.frame.height, field.frame.height, accuracy: 1)
    }
}

/// Verifies fixed controls against their dock and actual occluding system surfaces.
@MainActor
enum ConversationComposerDockUITestConditions {
    /// Existence alone can describe a keyboard outside the current app window.
    static func waitForVisibleKeyboard(in app: XCUIApplication) {
        let keyboard = app.keyboards.firstMatch
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            keyboard.exists && !keyboard.frame.intersection(app.frame).isEmpty
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [visible]), .completed)
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
