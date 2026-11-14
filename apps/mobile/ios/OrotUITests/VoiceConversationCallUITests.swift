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
        let identity = UITestConditions.element(app, "voice-call-identity")
        guard UITestConditions.exists(identity) else { XCTFail("Synthetic fixture readiness cancelled"); return }
        // Readiness is established independently; a wrong exact-ID query now fails immediately.
        let surface = UITestConditions.element(app, "voice-call-screen")
        guard surface.exists else { XCTFail("Missing voice-call-screen after fixture readiness"); return }
        // This diagnostic uses fixture text, not the saved-avatar provider; persistence is covered separately.
        XCTAssertEqual(identity.frame.midX, surface.frame.midX, accuracy: 2)
        XCTAssertGreaterThanOrEqual(identity.frame.minY, surface.frame.minY)
        XCTAssertLessThanOrEqual(identity.frame.maxX, surface.frame.maxX)
        let initial = XCTAttachment(screenshot: app.screenshot())
        initial.name = "synthetic-voice-large-text"
        initial.lifetime = .keepAlways
        add(initial)
        guard ready("Synthetic listening", in: app) else { return }
        guard tap("마이크 끄기", in: app, scroll: surface) else { return }
        guard ready("마이크가 꺼져 있어요.", in: app) else { return }
        guard tap("다시 듣기", in: app, scroll: surface) else { return }
        guard ready("Synthetic listening", in: app) else { return }
        guard tap("말하기 완료", in: app, scroll: surface) else { return }
        guard ready("Synthetic speaking", in: app) else { return }
        guard tap("답변 중단하고 말하기", in: app, scroll: surface) else { return }
        guard ready("Synthetic listening", in: app) else { return }
        guard tap("음성 대화 종료", in: app, scroll: surface) else { return }
        let closed = UITestConditions.element(app, "voice-fixture-state")
        let ended = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "closed"), object: closed)
        XCTAssertEqual(UITestConditions.wait(for: [ended]), .completed, app.debugDescription)
        XCTAssertFalse(surface.exists, "The call modal must leave the native hierarchy after End")
    }

    private func ready(_ status: String, in app: XCUIApplication) -> Bool {
        let ready = UITestConditions.exists(app.staticTexts[status])
        XCTAssertTrue(ready, "Voice phase observation cancelled: \(status)")
        return ready
    }

    /// Scroll only the known call-owned surface; never infer an owner from the application's modal windows.
    private func tap(_ label: String, in app: XCUIApplication, scroll: XCUIElement) -> Bool {
        let button = app.buttons[label]
        guard button.exists else { XCTFail("Missing call control: \(label)"); return false }
        // XXXL content may span several viewports. Keep navigation bounded and owned.
        for _ in 0 ..< 8 {
            if button.isHittable {
                break
            }
            if button.frame.maxY < scroll.frame.minY {
                scroll.swipeDown()
            } else {
                scroll.swipeUp()
            }
        }
        guard button.isHittable, button.isEnabled else { XCTFail("Unreachable call control: \(label)"); return false }
        XCTAssertGreaterThanOrEqual(button.frame.width, 44)
        XCTAssertGreaterThanOrEqual(button.frame.height, 44)
        button.tap()
        return true
    }
}
