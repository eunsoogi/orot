import XCTest

/// Synthetic identities isolate native transcript geometry; system notification delivery is not exercised.
@MainActor
final class ReplyFocusGeometryUITests: OrotFailFastTestCase {
    func testSavedReplyAndNewerGenerationRevealWithinRealViewport() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "reply-focus-native", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let scroll = UITestConditions.element(app, "rag-conversation-history")
        let trigger = app.buttons["Focus saved reply"]
        let newer = app.buttons["Focus newer generation"]
        XCTAssertTrue(UITestConditions.exists(scroll), app.debugDescription)
        XCTAssertTrue(trigger.isHittable && newer.isHittable)
        XCTAssertGreaterThanOrEqual(trigger.frame.height, 44)
        XCTAssertGreaterThanOrEqual(newer.frame.height, 44)

        let receipt = app.staticTexts["reply-focus-probe-receipt"]
        func answerBody(_ text: String) -> XCUIElement {
            app.staticTexts.matching(identifier: "rag-conversation-answer-body").matching(NSPredicate(format: "label == %@", text)).firstMatch
        }
        func assertOutside(_ text: String) {
            let answer = answerBody(text)
            XCTAssertTrue(!answer.exists || !scroll.frame.intersects(answer.frame), answer.debugDescription)
        }

        func assertRevealed(_ text: String, id: String, after generation: Int) -> Int {
            let answer = answerBody(text)
            let revealed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard answer.exists, scroll.exists else { return false }
                return scroll.frame.contains(answer.frame) && !answer.frame.isEmpty
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [revealed]), .completed, app.debugDescription)
            XCTAssertTrue(answer.exists && answer.isHittable, answer.debugDescription)
            XCTAssertTrue(scroll.frame.contains(answer.frame), answer.debugDescription)
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["idle"]), app.debugDescription)
            let completed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", "completed:\(id):"), object: receipt)
            XCTAssertEqual(UITestConditions.wait(for: [completed]), .completed, receipt.debugDescription)
            let next = Int(receipt.label.split(separator: ":").last ?? "") ?? 0
            XCTAssertGreaterThan(next, generation, receipt.debugDescription)
            return next
        }

        let latest = answerBody("Synthetic reply 32")
        let bottomSettled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            latest.exists && scroll.exists && scroll.frame.contains(latest.frame) && !latest.frame.isEmpty
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [bottomSettled]), .completed, app.debugDescription)
        assertOutside("Synthetic reply 4")
        trigger.tap()
        let first = assertRevealed("Synthetic reply 4", id: "synthetic-reply-4", after: 0)
        assertOutside("Synthetic reply 24")
        newer.tap()
        let second = assertRevealed("Synthetic reply 24", id: "synthetic-reply-24", after: first)
        assertOutside("Synthetic reply 4")
        let arm = app.buttons["Arm background reply"]
        XCTAssertTrue(arm.isHittable)
        XCTAssertGreaterThanOrEqual(arm.frame.height, 44)
        arm.tap()
        XCTAssertTrue(UITestConditions.exists(app.buttons["Background reply armed"]))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["background-delivered"]), app.debugDescription)
        _ = assertRevealed("Synthetic reply 4", id: "synthetic-reply-4", after: second)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Focused synthetic reply within transcript"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
