import XCTest

/// Real modal geometry and controls with synthetic audio/provider dependencies, not microphone or AEC evidence.
@MainActor
final class VoiceConversationCallUITests: OrotFailFastTestCase {
    func testSyntheticFullScreenCallMuteResumeAndEndWithLargeText() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_E2E_PROBE", "voice-call",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let surface = app.scrollViews["voice-call-screen"]
        guard UITestConditions.exists(surface) else { XCTFail(app.debugDescription); return }
        let identity = app.staticTexts["Orot synthetic fixture"]
        XCTAssertTrue(UITestConditions.exists(identity), app.debugDescription)
        // This diagnostic uses fixture text, not the saved-avatar provider; persistence is covered separately.
        XCTAssertEqual(identity.frame.midX, surface.frame.midX, accuracy: 2)
        XCTAssertGreaterThanOrEqual(identity.frame.minY, surface.frame.minY)
        XCTAssertLessThanOrEqual(identity.frame.maxX, surface.frame.maxX)
        let initial = XCTAttachment(screenshot: app.screenshot())
        initial.name = "synthetic-voice-large-text"
        initial.lifetime = .keepAlways
        add(initial)
        guard tap("마이크 끄기", in: app, scroll: surface) else { return }
        guard tap("다시 듣기", in: app, scroll: surface) else { return }
        guard tap("말하기 완료", in: app, scroll: surface) else { return }
        guard tap("답변 중단하고 말하기", in: app, scroll: surface) else { return }
        guard tap("음성 대화 종료", in: app, scroll: surface) else { return }
        let closed = UITestConditions.element(app, "voice-fixture-state")
        let ended = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "closed"), object: closed)
        XCTAssertEqual(XCTWaiter.wait(for: [ended], timeout: 5), .completed, app.debugDescription)
        XCTAssertFalse(surface.exists, "The call modal must leave the native hierarchy after End")
    }

    /// Scroll only the known call-owned surface; never infer an owner from the application's modal windows.
    private func tap(_ label: String, in app: XCUIApplication, scroll: XCUIElement) -> Bool {
        let button = app.buttons[label]
        guard UITestConditions.exists(button) else { XCTFail("Missing call control: \(label)"); return false }
        for _ in 0 ..< 3 {
            if button.isHittable {
                break
            }
            scroll.swipeUp()
        }
        guard button.isHittable, button.isEnabled else { XCTFail("Unreachable call control: \(label)"); return false }
        XCTAssertGreaterThanOrEqual(button.frame.width, 44)
        XCTAssertGreaterThanOrEqual(button.frame.height, 44)
        button.tap()
        return true
    }
}
