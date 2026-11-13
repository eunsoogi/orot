import XCTest

/// A real system notification opens the synthetic saved reply after the appearance gate.
@MainActor
final class AssistantReplyEntryUITests: OrotFailFastTestCase {
    func testSavedReplyWaitsForAppearanceAndOpensAfterSave() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "assistant-reply-acceptance", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let enable = app.buttons["assistant-reply-enable"]
        XCTAssertTrue(UITestConditions.exists(enable), app.debugDescription)
        XCTAssertTrue(enable.isHittable)
        guard enable.isHittable else { return }
        enable.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let permission = springboard.alerts.firstMatch
        XCTAssertTrue(UITestConditions.exists(permission), springboard.debugDescription)
        let allow = permission.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "허용"])).firstMatch
        XCTAssertTrue(allow.exists && allow.isHittable, permission.debugDescription)
        guard allow.exists, allow.isHittable else { return }
        allow.tap()
        let star = app.descendants(matching: .any).matching(identifier: "별").firstMatch
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        XCUIDevice.shared.press(.home)
        let banner = ReminderJourneyObservation.deliveredBanner(in: springboard, bodyText: "Synthetic retained reply")
        XCTAssertTrue(UITestConditions.exists(banner.container), springboard.debugDescription)
        XCTAssertTrue(UITestConditions.exists(banner.body), springboard.debugDescription)
        XCTAssertEqual(banner.body.label, "Synthetic retained reply")
        let bannerReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            banner.body.exists && banner.body.isHittable
        }, object: nil)
        let bannerResult = UITestConditions.wait(for: [bannerReady])
        XCTAssertEqual(bannerResult, .completed, banner.body.debugDescription)
        guard bannerResult == .completed else { return }
        banner.body.tap()
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "rag-conversation-screen").exists)
        XCTAssertTrue(star.isHittable)
        XCTAssertGreaterThanOrEqual(star.frame.width, 44)
        XCTAssertGreaterThanOrEqual(star.frame.height, 44)
        star.tap()
        let save = app.buttons["assistant-appearance-save"]
        XCTAssertEqual(save.label, "저장")
        XCTAssertNotNil(FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll"))
        XCTAssertTrue(save.isHittable && save.isEnabled)
        save.tap()

        let histories = app.descendants(matching: .any).matching(identifier: "rag-conversation-history")
        let answers = app.staticTexts.matching(identifier: "rag-conversation-answer-body").matching(NSPredicate(format: "label == %@", "Synthetic retained reply"))
        /// Resolve the exact answer and its viewport together without retaining navigation-time indices.
        func visibleReply() -> Bool {
            let frames = histories.allElementsBoundByAccessibilityElement.compactMap { try? $0.snapshot().frame }
            return answers.allElementsBoundByAccessibilityElement.contains { answer in
                guard let frame = try? answer.snapshot().frame, !frame.isEmpty, answer.isHittable else { return false }
                return frames.contains { $0.contains(frame) }
            }
        }
        let initialReply = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in visibleReply() }, object: nil)
        let initialResult = UITestConditions.wait(for: [initialReply])
        XCTAssertEqual(initialResult, .completed, app.debugDescription)
        guard initialResult == .completed else { return }
        XCUIDevice.shared.press(.home)
        app.activate()
        let returnedReply = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in visibleReply() }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [returnedReply]), .completed, app.debugDescription)
    }
}
