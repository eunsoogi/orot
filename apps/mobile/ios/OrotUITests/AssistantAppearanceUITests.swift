import XCTest

/// Uses the real app gate and protected local store in an isolated test-owned container.
@MainActor
final class AssistantAppearanceUITests: OrotFailFastTestCase {
    /// Compare the same XCTest text injection across the appearance field and the conversation composer.
    func testAppearanceAndConversationKeyboardInputRemainComplete() {
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
        let appearanceValue = name.value as? String
        let save = app.buttons["assistant-appearance-save"]
        guard FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll") != nil else { return }
        XCTAssertTrue(save.isHittable && save.isEnabled)
        save.tap()
        let ai = UITestConditions.element(app, "navigation-tab-ai")
        XCTAssertTrue(UITestConditions.exists(ai), app.debugDescription)
        ai.tap()
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable, app.debugDescription)
        input.tap()
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        input.typeText("Momo")
        let composerValue = input.value as? String
        // Keep the independent observations even if one field loses input.
        let data = try? JSONSerialization.data(withJSONObject: ["appearance": appearanceValue ?? "", "composer": composerValue ?? ""])
        if let data {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = "Synthetic keyboard input comparison"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertEqual(appearanceValue, "Momo")
        XCTAssertEqual(composerValue, "Momo")
    }

    func testRequiredAppearanceNameKeyboardAndRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "assistant-acceptance", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }

        let star = app.descendants(matching: .any).matching(identifier: "별").firstMatch
        let save = app.buttons["assistant-appearance-save"]
        let name = app.textFields["비서 이름"]
        XCTAssertTrue(UITestConditions.exists(star), "Requires a fresh test-owned app container: \(app.debugDescription)")
        XCTAssertFalse(UITestConditions.element(app, "navigation-tab-ai").exists)
        XCTAssertEqual(save.label, "저장")
        XCTAssertFalse(save.isEnabled)
        XCTAssertTrue(star.isHittable)
        XCTAssertTrue((star.value as? String)?.contains("radio button") == true, star.debugDescription)
        XCTAssertTrue((star.value as? String)?.contains("unchecked") == true, star.debugDescription)
        XCTAssertGreaterThanOrEqual(star.frame.width, 44)
        XCTAssertGreaterThanOrEqual(star.frame.height, 44)
        star.tap()
        XCTAssertTrue((star.value as? String)?.contains("checked") == true, star.debugDescription)
        XCTAssertFalse((star.value as? String)?.contains("unchecked") == true, star.debugDescription)
        XCTAssertTrue(name.exists && name.isHittable)
        XCTAssertGreaterThanOrEqual(name.frame.height, 44)
        name.tap()
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        name.typeText("Momo")
        XCTAssertEqual(name.value as? String, "Momo")
        XCTAssertNotNil(FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll"))
        XCTAssertTrue(save.isHittable && save.isEnabled)
        XCTAssertGreaterThanOrEqual(save.frame.width, 44)
        XCTAssertGreaterThanOrEqual(save.frame.height, 44)
        save.tap()
        let ai = UITestConditions.element(app, "navigation-tab-ai")
        XCTAssertTrue(UITestConditions.exists(ai), app.debugDescription)
        XCTAssertTrue(ai.isHittable)
        XCTAssertGreaterThanOrEqual(ai.frame.width, 44)
        XCTAssertGreaterThanOrEqual(ai.frame.height, 44)
        ai.tap()
        let identity = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Momo")).firstMatch
        XCTAssertTrue(UITestConditions.exists(identity), app.debugDescription)
        XCTAssertGreaterThanOrEqual(identity.frame.height, 44)

        app.terminate()
        app.launch()
        XCTAssertTrue(UITestConditions.exists(ai), app.debugDescription)
        XCTAssertFalse(star.exists)
        ai.tap()
        XCTAssertTrue(UITestConditions.exists(identity), app.debugDescription)
        XCTAssertTrue(identity.isHittable)
        identity.tap()
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        XCTAssertTrue((star.value as? String)?.contains("checked") == true, star.debugDescription)
        XCTAssertFalse((star.value as? String)?.contains("unchecked") == true, star.debugDescription)
        XCTAssertEqual(name.value as? String, "Momo")
        let cancel = app.buttons["취소"]
        XCTAssertTrue(cancel.isHittable)
        XCTAssertGreaterThanOrEqual(cancel.frame.width, 44)
        XCTAssertGreaterThanOrEqual(cancel.frame.height, 44)
        cancel.tap()
        XCTAssertTrue(UITestConditions.exists(identity), app.debugDescription)

        // A synthetic local-data lookup stays pending; no model or network request is made.
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(input.exists && input.isHittable)
        input.tap()
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        input.typeText("What health records are available?")
        // The native material host shares this ID; only its button sends the request.
        let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
        XCTAssertTrue(send.isHittable)
        XCTAssertGreaterThanOrEqual(send.frame.width, 44)
        XCTAssertGreaterThanOrEqual(send.frame.height, 44)
        send.tap()
        // Preserve the synthetic post-send screen even if the expected stage never appears.
        let sentScreenshot = XCTAttachment(screenshot: app.screenshot())
        sentScreenshot.name = "Assistant request after send"
        sentScreenshot.lifetime = .keepAlways
        add(sentScreenshot)
        let waiting = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "응답을 기다리고 있어요")).firstMatch
        XCTAssertTrue(UITestConditions.exists(waiting), app.debugDescription)
        XCTAssertTrue(waiting.label.contains("Momo"))
        XCTAssertFalse(app.descendants(matching: .any)["rag-conversation-activity-bubble"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Assistant waiting activity"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
