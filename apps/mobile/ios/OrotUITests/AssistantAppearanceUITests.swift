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
        // Synchronize controlled input events, then prove the exact draft before persistence.
        for character in "Momo" {
            app.typeText(String(character))
        }
        guard waitForName(name, equals: "Momo") else { return }
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
        assertFloatingIdentity(identity, in: app)
        let composer = app.textViews["rag-conversation-input"]
        XCTAssertTrue(UITestConditions.exists(composer), app.debugDescription)
        composer.tap()
        ConversationComposerDockUITestConditions.waitForVisibleKeyboard(in: app)
        assertFloatingIdentity(identity, in: app)
        // Editing remains reachable with the keyboard visible and does not send a prompt.
        identity.tap()
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        XCTAssertTrue((star.value as? String)?.contains("checked") == true, star.debugDescription)
        XCTAssertFalse((star.value as? String)?.contains("unchecked") == true, star.debugDescription)
        XCTAssertEqual(name.value as? String, "Momo")
        // This already-visible modal field needs no cross-window form scrolling or inferred window owner.
        guard name.isHittable else { XCTFail("Appearance name is not reachable"); return }
        let existingName = name.value as? String ?? ""
        name.tap()
        // Hardware Command-A is not reliable in this modal. Delete the observed text length;
        // an existing full selection clears on the first delete and subsequent deletes are harmless.
        app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existingName.count))
        guard waitForName(name, equals: "") else { return }
        for character in "Momo Companion Long Name" {
            app.typeText(String(character))
        }
        guard waitForName(name, equals: "Momo Companion Long Name") else { return }
        // The keyboard may cover Save; scroll only this observed modal-owned form.
        let appearanceScroll = UITestConditions.element(app, "assistant-appearance-scroll")
        guard appearanceScroll.exists else { XCTFail("Appearance form is missing"); return }
        for _ in 0 ..< 3 {
            if save.isHittable {
                break
            }
            appearanceScroll.swipeUp()
        }
        guard save.isHittable, save.isEnabled else { XCTFail("Appearance save is not reachable"); return }
        save.tap()
        XCTAssertTrue(UITestConditions.exists(identity), app.debugDescription)
        XCTAssertEqual(identity.label, "Momo Companion Long Name, 비서 꾸미기")
        assertFloatingIdentity(identity, in: app)
    }

    /// Require the native field's observed value without retrying or repairing a failed edit.
    private func waitForName(_ field: XCUIElement, equals value: String) -> Bool {
        // UIKit exposes an empty text field's placeholder as its accessibility value.
        let predicate = value.isEmpty
            ? NSPredicate(format: "value == %@ OR value == %@", "", field.placeholderValue ?? "")
            : NSPredicate(format: "value == %@", value)
        let match = XCTNSPredicateExpectation(predicate: predicate, object: field)
        let passed = XCTWaiter.wait(for: [match], timeout: 3) == .completed
        XCTAssertTrue(passed, "Expected name \(value), observed \(String(describing: field.value))")
        return passed
    }

    /// Observe actual UIKit bounds; component style assertions cannot prove floating placement or touch reachability.
    private func assertFloatingIdentity(_ identity: XCUIElement, in app: XCUIApplication) {
        let surface = UITestConditions.element(app, "assistant-floating-surface")
        XCTAssertTrue(UITestConditions.exists(surface), app.debugDescription)
        XCTAssertTrue(identity.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(identity.frame.width, 44)
        XCTAssertGreaterThanOrEqual(identity.frame.height, 44)
        XCTAssertEqual(identity.frame.midX, surface.frame.midX, accuracy: 2)
        XCTAssertGreaterThanOrEqual(identity.frame.minY, surface.frame.minY)
        XCTAssertLessThanOrEqual(identity.frame.minY - surface.frame.minY, 12)
        XCTAssertLessThanOrEqual(identity.frame.maxX, surface.frame.maxX)
        XCTAssertLessThanOrEqual(identity.frame.maxY, surface.frame.maxY)
    }
}
