import XCTest

/// Synthetic recipients only: actual three-tab controls and UUID-isolated Keychain/SQLCipher survive app termination.
final class SettingsConsentUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testExplicitThreeTabGrantsAndRevocationSurviveProcessRestart() {
        let app = XCUIApplication()
        let identifier = "test-settings-consent-\(UUID().uuidString.lowercased())"
        defer { app.terminate() }
        launch(app, identifier, "create")
        inspect(app, expected: "renewal_required")
        tap(app, "provider-option-0", scroll: "settings-provider-screen")
        confirm(app, recipient: "선택한 ChatGPT 계정")
        tap(app, "model-tab-calendar", scroll: "settings-provider-screen")
        tap(app, "calendar-model-refresh", scroll: "settings-provider-screen")
        tap(app, "provider-option-1", scroll: "settings-provider-screen")
        confirm(app, recipient: "OpenAI API")
        tap(app, "model-tab-voice", scroll: "settings-provider-screen")
        tap(app, "voice-model-refresh", scroll: "settings-provider-screen")
        tap(app, "voice-model-gpt-realtime-2.1-mini", scroll: "settings-provider-screen")
        let disclosure = node(app, "model-settings-transmission-disclosure")
        XCTAssertTrue(UITestConditions.exists(disclosure))
        XCTAssertTrue(UITestConditions.text(disclosure).contains("OpenAI Realtime API"))
        tap(app, "voice-settings-save", scroll: "settings-provider-screen")
        XCTAssertTrue(wait { self.node(app, "voice-current-model").exists && UITestConditions.text(self.node(app, "voice-current-model")).contains("GPT Realtime 2.1 mini") })
        inspect(app, expected: "authorized")
        app.terminate()
        launch(app, identifier, "reopen")
        inspect(app, expected: "authorized")
        // Retain SQL grant rows deliberately: the durable authority tombstone must deny them after restart.
        tap(app, "settings-consent-native-revoke")
        inspect(app, expected: "renewal_required")
        app.terminate()
        launch(app, identifier, "reopen")
        inspect(app, expected: "renewal_required")
        app.terminate()
        launch(app, identifier, "cleanup")
        let cleanup = node(app, "settings-consent-native-setup")
        XCTAssertTrue(UITestConditions.exists(cleanup))
        XCTAssertTrue(wait { UITestConditions.text(cleanup).contains("synthetic-cleanup-complete") })
    }

    @MainActor
    private func launch(_ app: XCUIApplication, _ identifier: String, _ phase: String) {
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "settings-provider-layout",
            "-OROT_SETTINGS_CONSENT", "synthetic",
            "-OROT_SETTINGS_CONSENT_FIXTURE", identifier,
            "-OROT_SETTINGS_CONSENT_PHASE", phase,
        ]
        app.launch()
        if phase != "cleanup" {
            XCTAssertTrue(UITestConditions.exists(node(app, "settings-consent-native-inspect")))
        }
    }

    @MainActor
    private func confirm(_ app: XCUIApplication, recipient: String) {
        let disclosure = node(app, "model-settings-transmission-disclosure")
        XCTAssertTrue(UITestConditions.exists(disclosure))
        XCTAssertTrue(UITestConditions.text(disclosure).contains(recipient))
        tap(app, "provider-selection-confirm", scroll: "settings-provider-screen")
        XCTAssertTrue(wait { !self.node(app, "provider-selection-confirm").exists })
    }

    @MainActor
    private func inspect(_ app: XCUIApplication, expected: String) {
        tap(app, "settings-consent-native-inspect")
        let status = node(app, "settings-consent-native-status")
        XCTAssertTrue(wait {
            let text = UITestConditions.text(status)
            return ["conversation", "calendar", "voice"].allSatisfy {
                text.contains("\"\($0)\":\"\(expected)\"")
            } && text.contains("\"providerExecution\":\"not-configured\"") && text.contains("\"synthetic\":true")
        })
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String, scroll: String? = nil) {
        let target = node(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target))
        if let scroll {
            FormUITestConditions.reveal(target, in: app, scroll: node(app, scroll), towardTop: identifier.hasPrefix("model-tab-"))
        }
        XCTAssertTrue(wait { target.isHittable && target.isEnabled })
        target.tap()
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", identifier)).firstMatch
    }

    @MainActor
    private func wait(_ condition: @escaping @MainActor () -> Bool) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated { condition() }
        }, object: nil)
        return UITestConditions.wait(for: [expectation]) == .completed
    }
}
