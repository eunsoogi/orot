import XCTest

/// Shared classification pagination and retry observations.
@MainActor
enum DisclosureLayoutUITestObservations {
    /// Reads the actual paged text; inline paragraphs are not separate UIKit accessibility elements.
    static func assertClassificationText(_ app: XCUIApplication, contains expected: String, in testCase: AppointmentConsentUITests) {
        let page = testCase.node(app, "classification-page-text")
        XCTAssertTrue(page.waitForAppearance())
        var visited = Set<String>()
        while !UITestConditions.text(page).contains(expected) {
            let text = UITestConditions.text(page)
            guard visited.insert(text).inserted else { break }
            let next = testCase.node(app, "medical-appointment-next-result")
            guard next.isEnabled else { break }
            testCase.tap(app, "medical-appointment-next-result")
            let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                UITestConditions.text(page) != text
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed)
        }
        XCTAssertTrue(UITestConditions.text(page).contains(expected), app.debugDescription)
    }

    /// A retry returns to confirmation before another explicit start can request consent.
    static func startClassification(_ app: XCUIApplication, in testCase: AppointmentConsentUITests) {
        if testCase.node(app, "medical-appointment-results").exists {
            testCase.tap(app, "medical-appointment-import")
            XCTAssertTrue(testCase.node(app, "medical-appointment-confirmation").waitForAppearance())
        }
        testCase.tap(app, "medical-appointment-import")
    }
}

/// Actual settings controls and isolated protected grants, never a preapproved execution port.
@MainActor
enum ClassificationConsentUITestSupport {
    static func launch(_ app: XCUIApplication, extra: [String] = []) -> String {
        let fixture = "test-settings-consent-\(UUID().uuidString.lowercased())"
        app.launchArguments = arguments(fixture, phase: "create") + extra
        app.launch()
        XCTAssertTrue(UITestConditions.element(app, "calendar-classification-synthetic-provider-calls").waitForAppearance())
        return fixture
    }

    static func cleanup(_ app: XCUIApplication, fixture: String, testCase: AppointmentConsentUITests) {
        app.terminate()
        app.launchArguments = arguments(fixture, phase: "cleanup")
        app.launch()
        UITestConditions.value(testCase.node(app, "classification-consent-setup"), equals: "synthetic-cleanup-complete")
        app.terminate()
    }

    private static func arguments(_ fixture: String, phase: String) -> [String] {
        ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "medical-appointment-classification",
         "-OROT_SETTINGS_CONSENT_FIXTURE", fixture, "-OROT_SETTINGS_CONSENT_PHASE", phase,
         "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    }

    static func assertBlocked(_ app: XCUIApplication, testCase: AppointmentConsentUITests) {
        UITestConditions.value(testCase.node(app, "calendar-classification-synthetic-provider-calls"), equals: "syntheticProviderCalls=0")
        XCTAssertFalse(testCase.node(app, "calendar-classification-synthetic-calendar-save").exists)
        XCTAssertFalse(testCase.node(app, "inference-disclosure-sheet").exists)
        XCTAssertFalse(testCase.node(app, "medical-appointment-manual").exists)
    }

    static func openSettingsChoice(_ app: XCUIApplication, testCase: AppointmentConsentUITests) {
        testCase.tap(app, "medical-appointment-select-provider")
        testCase.tap(app, "calendar-model-refresh")
        testCase.tap(app, "provider-option-0")
        XCTAssertTrue(testCase.node(app, "provider-selection-confirmation").waitForAppearance())
    }

    static func assertSettingsControls(_ app: XCUIApplication, testCase: AppointmentConsentUITests) {
        let page = testCase.node(app, "classification-consent-scroll")
        for identifier in ["model-settings-transmission-disclosure", "provider-selection-confirm", "provider-selection-cancel"] {
            let control = testCase.node(app, identifier)
            XCTAssertTrue(control.exists)
            FormUITestConditions.reveal(control, in: app, scroll: page)
            XCTAssertFalse(control.frame.isEmpty)
            XCTAssertTrue(app.frame.contains(control.frame))
            XCTAssertTrue(control.isHittable)
        }
        // Measure both actions together after revealing the final settings decision.
        let allow = testCase.node(app, "provider-selection-confirm")
        let decline = testCase.node(app, "provider-selection-cancel")
        // Do not reveal again: both decisions must remain reachable at the same scroll position.
        for action in [allow, decline] {
            XCTAssertTrue(action.exists)
            XCTAssertFalse(action.frame.isEmpty)
            XCTAssertTrue(app.frame.contains(action.frame))
            XCTAssertTrue(action.isHittable)
        }
        XCTAssertFalse(allow.frame.intersects(decline.frame))
    }
}
