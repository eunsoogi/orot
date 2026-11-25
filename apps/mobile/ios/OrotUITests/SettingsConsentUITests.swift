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
        tap(app, "voice-model-gpt-live-1.1", scroll: "settings-provider-screen")
        tap(app, "voice-tool-model-gpt-6-luna", scroll: "settings-provider-screen")
        let disclosure = node(app, "model-settings-transmission-disclosure")
        XCTAssertFalse(disclosure.exists)
        tap(app, "voice-settings-save", scroll: "settings-provider-screen")
        let voiceApproval = node(app, "inference-disclosure-recipient")
        XCTAssertTrue(UITestConditions.exists(voiceApproval))
        XCTAssertTrue(UITestConditions.text(voiceApproval).contains("OpenAI Live API"))
        tap(app, "inference-disclosure-allow", scroll: "inference-disclosure-content")
        XCTAssertTrue(wait { UITestConditions.text(voiceApproval).contains("OpenAI Responses (Live)") })
        tap(app, "inference-disclosure-allow", scroll: "inference-disclosure-content")
        XCTAssertTrue(wait { self.node(app, "voice-current-model").exists && UITestConditions.text(self.node(app, "voice-current-model")).contains("GPT-Live-1.1") })
        inspect(app, expected: "authorized")
        app.terminate()
        launch(app, identifier, "reopen", canonicalQueue: true)
        inspect(app, expected: "authorized")
        verifyCanonicalQueueAndHeldRevocation(app)
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
    private func launch(_ app: XCUIApplication, _ identifier: String, _ phase: String,
                        boundaries: Bool = false, canonicalQueue: Bool = false)
    {
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "settings-provider-layout",
            "-OROT_SETTINGS_CONSENT", "synthetic",
            "-OROT_SETTINGS_CONSENT_FIXTURE", identifier,
            "-OROT_SETTINGS_CONSENT_PHASE", phase,
        ]
        if boundaries || canonicalQueue {
            app.launchArguments += ["-OROT_TEST_HOST", "-OROT_SETTINGS_CONSENT_BOUNDARIES", "synthetic"]
        }
        if canonicalQueue {
            app.launchArguments += ["-OROT_SETTINGS_CONSENT_CANONICAL_QUEUE", "synthetic",
                                    "-OROT_SETTINGS_CONSENT_CANONICAL_OPEN", "synthetic"]
        }
        app.launch()
        if canonicalQueue {
            XCTAssertTrue(UITestConditions.exists(node(app, "settings-canonical-queue-status")))
        } else if boundaries {
            XCTAssertTrue(UITestConditions.exists(node(app, "settings-boundary-status")))
        } else if phase != "cleanup" {
            XCTAssertTrue(UITestConditions.exists(node(app, "settings-consent-native-inspect")))
        }
    }

    @MainActor
    private func verifyComposedCanonicalOpen(_ app: XCUIApplication) {
        let status = node(app, "settings-canonical-open-status")
        for scenario in ["open-allow", "open-decline", "open-mismatch", "open-reject-transfer", "open-locked", "open-retired"] {
            tap(app, "settings-canonical-" + scenario)
            let review = app.alerts["이번 통화에서 건강 기록 도구를 사용할까요?"]
            XCTAssertTrue(UITestConditions.exists(review))
            if scenario == "open-retired" {
                XCUIDevice.shared.press(.home)
                app.activate()
            } else {
                review.buttons[scenario == "open-decline" ? "음성만 사용" : "이번 통화에 사용"].tap()
            }
            XCTAssertTrue(wait { UITestConditions.text(status) == scenario + "-passed" })
        }
    }

    /// The exact known paired Settings grant must work through the test bridge only.
    @MainActor
    private func verifyCanonicalQueueAndHeldRevocation(_ app: XCUIApplication) {
        let prefix = "settings-canonical-queue-"
        let status = node(app, prefix + "status")
        let invocations = node(app, prefix + "invocations")
        let completed = node(app, prefix + "completed")
        func expectStatus(_ expected: String) {
            XCTAssertTrue(wait { UITestConditions.text(status) == expected })
        }
        func expectInvocations(_ expected: Int) {
            XCTAssertTrue(wait { UITestConditions.text(invocations) == String(expected) })
        }
        tap(app, prefix + "review")
        expectStatus("review")
        tap(app, prefix + "deny-review")
        expectStatus("rejected")
        tap(app, prefix + "allow")
        XCTAssertTrue(wait { UITestConditions.text(completed) == "2" })
        expectStatus("rejected")
        expectInvocations(0)
        tap(app, prefix + "review")
        expectStatus("review")
        tap(app, prefix + "approve")
        expectStatus("approved")
        for (index, scenario) in ["allow", "deny", "replace"].enumerated() {
            tap(app, prefix + scenario)
            expectStatus("queue-\(scenario)-passed")
            expectInvocations(index + 1)
        }

        verifyComposedCanonicalOpen(app)

        // Retain stored pair/SQL rows deliberately while invalidating the authority witness.
        tap(app, prefix + "review")
        expectStatus("review")
        tap(app, "settings-consent-native-revoke")
        inspect(app, expected: "renewal_required")
        tap(app, prefix + "approve")
        expectStatus("rejected")
        expectInvocations(3)
        tap(app, prefix + "allow")
        XCTAssertTrue(wait { UITestConditions.text(completed) == "8" })
        expectStatus("rejected")
        expectInvocations(3)
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
        XCTAssertFalse(node(app, "model-settings-transmission-disclosure").exists)
        tap(app, "provider-selection-confirm", scroll: "settings-provider-screen")
        let disclosure = node(app, "inference-disclosure-recipient")
        XCTAssertTrue(UITestConditions.exists(disclosure))
        XCTAssertTrue(UITestConditions.text(disclosure).contains(recipient))
        tap(app, "inference-disclosure-allow", scroll: "inference-disclosure-content")
        XCTAssertTrue(wait { !disclosure.exists })
        XCTAssertTrue(wait { !self.node(app, "provider-selection-confirm").exists })
    }

    @MainActor
    private func inspect(_ app: XCUIApplication, expected: String) {
        tap(app, "settings-consent-native-inspect")
        let status = node(app, "settings-consent-native-status")
        XCTAssertTrue(wait {
            let text = UITestConditions.text(status)
            return ["conversation", "calendar", "voice", "voiceResponses"].allSatisfy {
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
