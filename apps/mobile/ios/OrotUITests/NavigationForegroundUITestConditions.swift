import XCTest

/// Exercises the OS lifecycle without relaunching the app or replacing its retained route.
@MainActor
enum NavigationForegroundUITestConditions {
    /// Fresh owned fixtures must finish the real appearance gate before the retained-route journey.
    /// This neutral selection uses the production save action; it grants no model or data permission.
    static func prepareFreshAppearance(_ app: XCUIApplication) {
        let star = UITestConditions.element(app, "별")
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        XCTAssertTrue(star.isHittable)
        star.tap()
        let save = app.buttons["assistant-appearance-save"]
        guard FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll") != nil else { return }
        XCTAssertTrue(save.isHittable && save.isEnabled)
        save.tap()
    }

    static func restoreEditableDraft(_ app: XCUIApplication, draft: String, citation: XCUIElement) throws {
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(citation.exists)
        XCUIDevice.shared.press(.home)
        let background = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.state == .runningBackground || app.state == .runningBackgroundSuspended
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [background], timeout: 10), .completed,
                       "The app must actually enter the background")
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        let editable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            input.exists && input.isHittable && (input.value as? String) == draft && citation.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [editable], timeout: 15), .completed,
                       "Foreground return must expose the retained content and editor, not a blocking veil")
        // A real edit detects an invisible input-blocking overlay; do not dispatch another request.
        input.tap()
        input.typeText("!")
        XCTAssertEqual(input.value as? String, draft + "!")
        input.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(citation.exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "retained-content-after-foreground"
        attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: "Foreground retained draft and visible content") { $0.add(attachment) }
        // Compare final navigation with the original keyboard-free root after proving real editing.
        // A real prose tap uses the history scroll view's normal unhandled-tap dismissal, not a test API.
        let prose = app.staticTexts["rag-conversation-answer-body"]
        XCTAssertTrue(prose.exists && prose.isHittable)
        prose.tap()
        let keyboardHidden = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !app.keyboards.firstMatch.exists
                && UITestConditions.element(app, "ai-feature-visit-questions-keyboard-hidden").exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardHidden], timeout: 10), .completed,
                       "Native keyboard and fixture keyboard event must agree before root geometry comparison")
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(citation.exists)
    }
}
