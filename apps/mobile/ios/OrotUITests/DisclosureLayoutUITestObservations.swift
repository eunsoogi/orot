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

/// Reads only the synthetic results document; native line breaks are presentation, not changed failure semantics.
@MainActor
enum ClassificationFailureNoticeUITestSupport {
    static let messagePattern = #"^1번째묶음처리중[0-9]+초후중단됐어요\.(.+)완료한분류는유지했어요\.$"#

    static func assertNotice(_ app: XCUIApplication, reason: String, testCase: AppointmentConsentUITests) {
        // These diagnostics must never become an arbitrary production-screen transcript collector.
        guard app.launchArguments.contains("medical-appointment-classification"),
              app.launchArguments.contains(where: { $0.hasPrefix("test-settings-consent-") })
        else {
            XCTFail("Failure reader requires the isolated synthetic classification fixture")
            return
        }
        var observations: [[String: Any]] = []
        defer {
            if let data = try? JSONSerialization.data(withJSONObject: observations, options: [.sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "synthetic-classification-failure-pages"
                attachment.lifetime = .keepAlways
                testCase.add(attachment)
            }
        }
        let results = testCase.node(app, "medical-appointment-results")
        // This fixture's local denial/failure has no remote I/O; a bounded observation fails rather than hanging forever.
        guard results.waitForExistence(timeout: 10) else {
            observations.append(["stageExists": false])
            XCTFail("Synthetic failure did not reach its results stage")
            return
        }
        let previous = results.descendants(matching: .any).matching(identifier: "medical-appointment-previous-result").firstMatch
        guard previous.exists, !previous.isEnabled else {
            observations.append(["firstPage": false])
            XCTFail("Failure reading must begin at the first document page")
            return
        }
        var pages: [String] = []
        var seen = Set<String>()
        for index in 0 ..< 256 {
            let targets = results.descendants(matching: .any).matching(identifier: "classification-page-text")
            let count = targets.count
            var record: [String: Any] = ["page": index, "targetCount": count]
            if count == 1, let snapshot = try? targets.firstMatch.snapshot() {
                record["type"] = String(describing: snapshot.elementType)
                record["label"] = String(snapshot.label.prefix(2048))
                record["value"] = String((snapshot.value as? String ?? "").prefix(2048))
            }
            observations.append(record)
            guard count == 1 else {
                XCTFail("Expected exactly one results-scoped native page target")
                return
            }
            let target = targets.firstMatch
            let text = UITestConditions.text(target)
            let viewport = results.descendants(matching: .any).matching(identifier: "classification-text-viewport").firstMatch
            guard !text.isEmpty, text.count <= 2048, seen.insert(text).inserted,
                  viewport.exists, !target.frame.isEmpty,
                  viewport.frame.insetBy(dx: -1, dy: -1).contains(target.frame),
                  app.frame.contains(viewport.frame)
            else {
                XCTFail("Failure page is empty, repeated, oversized or outside its native viewport")
                return
            }
            pages.append(text)
            let next = results.descendants(matching: .any).matching(identifier: "medical-appointment-next-result").firstMatch
            guard next.exists else {
                XCTFail("Failure reader lost its paging control")
                return
            }
            if !next.isEnabled {
                assertMessage(pages, reason: reason)
                return
            }
            guard next.isHittable else {
                XCTFail("The next failure page is not reachable")
                return
            }
            next.tap()
            let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                target.exists && UITestConditions.text(target) != text
            }, object: nil)
            guard XCTWaiter.wait(for: [changed], timeout: 10) == .completed else {
                XCTFail("The failure reader did not advance to a distinct native page")
                return
            }
        }
        XCTFail("Failure document exceeded the bounded page inventory")
    }

    static func assertMessage(_ pages: [String], reason: String) {
        // Preserve the complete batch/timing/category/preserved-results contract; normalize only rendering whitespace.
        let text = pages.joined().filter { !$0.isWhitespace }
        let expectedReason = reason.filter { !$0.isWhitespace }
        guard let regex = try? NSRegularExpression(pattern: messagePattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let reasonRange = Range(match.range(at: 1), in: text)
        else {
            XCTFail("Failure document does not contain the complete first-batch summary")
            return
        }
        XCTAssertEqual(String(text[reasonRange]), expectedReason)
    }
}
