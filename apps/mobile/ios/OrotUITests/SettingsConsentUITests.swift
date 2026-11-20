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
        verifyNativeBoundaries(app)
    }

    @MainActor
    private func launch(_ app: XCUIApplication, _ identifier: String, _ phase: String, boundaries: Bool = false) {
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "settings-provider-layout",
            "-OROT_SETTINGS_CONSENT", "synthetic",
            "-OROT_SETTINGS_CONSENT_FIXTURE", identifier,
            "-OROT_SETTINGS_CONSENT_PHASE", phase,
        ]
        if boundaries {
            app.launchArguments += ["-OROT_TEST_HOST", "-OROT_SETTINGS_CONSENT_BOUNDARIES", "synthetic"]
        }
        app.launch()
        if boundaries {
            XCTAssertTrue(UITestConditions.exists(node(app, "settings-boundary-status")))
        } else if phase != "cleanup" {
            XCTAssertTrue(UITestConditions.exists(node(app, "settings-consent-native-inspect")))
        }
    }

    /// Separate UUIDs keep credential mutation and bridge cancellation independent.
    @MainActor
    private func verifyNativeBoundaries(_ app: XCUIApplication) {
        let credential = "test-settings-consent-\(UUID().uuidString.lowercased())"
        app.terminate()
        launch(app, credential, "create", boundaries: true)
        boundaryStatus(app, "\"voice\":\"authorized\"")
        tap(app, "settings-boundary-replace")
        boundaryStatus(app, "\"voice\":\"renewal_required\"")
        app.terminate()
        launch(app, credential, "reopen", boundaries: true)
        boundaryStatus(app, "\"voice\":\"renewal_required\"")
        tap(app, "settings-boundary-approve")
        boundaryStatus(app, "\"voice\":\"authorized\"")
        tap(app, "settings-boundary-remove")
        boundaryStatus(app, "\"voice\":\"renewal_required\"")
        app.terminate()
        launch(app, credential, "reopen", boundaries: true)
        boundaryStatus(app, "\"voice\":\"renewal_required\"")
        app.terminate()
        launch(app, credential, "cleanup", boundaries: true)
        boundaryStatus(app, "synthetic-cleanup-complete")
        app.terminate()
        let bridge = "test-settings-consent-\(UUID().uuidString.lowercased())"
        launch(app, bridge, "create", boundaries: true)
        boundaryStatus(app, "\"voice\":\"authorized\"")
        tap(app, "settings-boundary-open")
        boundaryStatus(app, "\"opens\":1")
        boundaryStatus(app, "\"audioStarts\":1")
        boundaryStatus(app, "\"readyEvents\":1")
        tap(app, "settings-boundary-revoke")
        boundaryStatus(app, "\"closes\":1")
        boundaryStatus(app, "\"audioStops\":1")
        boundaryStatus(app, "\"audioStarts\":1")
        boundaryStatus(app, "\"readyEvents\":1")
        boundaryStatus(app, "\"transport\":\"in-memory\"")
        app.terminate()
        launch(app, bridge, "cleanup", boundaries: true)
        boundaryStatus(app, "synthetic-cleanup-complete")
    }

    @MainActor
    private func boundaryStatus(_ app: XCUIApplication, _ expected: String) {
        XCTAssertTrue(wait { UITestConditions.text(self.node(app, "settings-boundary-status")).contains(expected) })
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
