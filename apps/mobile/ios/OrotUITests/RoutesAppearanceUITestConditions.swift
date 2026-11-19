import XCTest

/// Only App-backed synthetic Routes cases opt into the real onboarding UI.
/// Existing choices are retained; no fixture storage or production gate is bypassed.
@MainActor
enum RoutesAppearanceUITestConditions {
    static func prepare(_ app: XCUIApplication) throws {
        let conversation = UITestConditions.element(app, "rag-conversation-screen")
        let onboarding = UITestConditions.element(app, "assistant-appearance-scroll")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            conversation.exists || onboarding.exists
        }, object: nil)
        guard UITestConditions.wait(for: [ready]) == .completed else {
            XCTFail("Routes appearance preparation was interrupted")
            throw PreparationFailure.interrupted
        }
        if !conversation.exists {
            // The stable identifier lets reveal prove the owning AX window even when multiple windows exist.
            let star = UITestConditions.element(app, "assistant-appearance-avatar-star")
            _ = try XCTUnwrap(FormUITestConditions.reveal(star, in: app, scrollID: "assistant-appearance-scroll"))
            XCTAssertEqual(star.label, "별")
            guard star.isHittable else { throw PreparationFailure.unreachable }
            star.tap()
            let save = app.buttons["assistant-appearance-save"]
            _ = try XCTUnwrap(FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll"))
            guard save.isEnabled, save.isHittable else { throw PreparationFailure.unreachable }
            save.tap()
        }
        // Wait for the encrypted preference commit and actual production App mount.
        guard UITestConditions.exists(conversation) else { throw PreparationFailure.interrupted }
        XCTAssertFalse(onboarding.exists, app.debugDescription)
    }

    private enum PreparationFailure: Error { case interrupted, unreachable }
}
