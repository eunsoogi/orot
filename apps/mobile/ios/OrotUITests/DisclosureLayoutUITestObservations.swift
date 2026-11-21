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
            guard next.exists, next.isEnabled else { break }
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
        guard let (page, scroll) = settingsScroll(app) else { return }
        for identifier in ["calendar-model-refresh", "provider-option-0"] {
            let matches = scroll.descendants(matching: .any).matching(identifier: identifier)
            let target = matches.firstMatch
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in matches.count == 1 && target.exists && target.isEnabled }, object: nil)
            guard UITestConditions.wait(for: [ready]) == .completed else { XCTFail("Expected one enabled settings control: \(identifier)"); return }
            guard FormUITestConditions.reveal(target, in: app, scroll: scroll, windowResolver: {
                FormWindowOwnership.resolve(app, scroll: page, target: target)
            }) != nil else { return }
            guard target.exists, target.isEnabled, target.isHittable else { XCTFail("Settings control is not tappable: \(identifier)"); return }
            target.tap()
        }
        XCTAssertTrue(testCase.node(app, "provider-selection-confirmation").waitForAppearance())
    }

    static func settingsScroll(_ app: XCUIApplication) -> (XCUIElement, XCUIElement)? {
        // The tagged React Native wrapper owns the AX window; its native child owns scrolling.
        let pages = app.descendants(matching: .any).matching(identifier: "classification-consent-scroll")
        guard pages.firstMatch.waitForAppearance(), pages.count == 1 else { XCTFail("Expected one classification settings scroll host"); return nil }
        let page = pages.firstMatch
        let scroll = page.elementType == .scrollView ? page : page.scrollViews.firstMatch
        guard page.elementType == .scrollView || page.scrollViews.count == 1, scroll.exists,
              scroll.scrollViews.count == 0 else { XCTFail("Expected one native classification settings ScrollView"); return nil }
        return (page, scroll)
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
        let results = testCase.node(app, "medical-appointment-results")
        observe(app, results: results, phase: "before-stage-wait", testCase: testCase)
        // This synthetic fixture has no remote I/O; bounded observation fails rather than hanging forever.
        let appeared = results.waitForExistence(timeout: 10)
        observe(app, results: results, phase: "after-stage-wait", testCase: testCase)
        guard appeared else {
            XCTFail("Synthetic failure did not reach its results stage")
            return
        }
        let previous = testCase.node(app, "medical-appointment-previous-result")
        guard validStage(app, results: results), !previous.exists || !previous.isEnabled else {
            XCTFail("Failure reading must begin at the unique results stage's first page")
            return
        }
        var pages: [String] = []
        var seen = Set<String>()
        for index in 0 ..< 256 {
            observe(app, results: results, phase: "page-\(index)", testCase: testCase)
            let targets = app.descendants(matching: .any).matching(identifier: "classification-page-text")
            guard validStage(app, results: results), targets.count == 1 else {
                XCTFail("Expected exactly one page in the unique results screen")
                return
            }
            let target = targets.firstMatch
            let text = UITestConditions.text(target)
            let viewport = testCase.node(app, "classification-text-viewport")
            guard !text.isEmpty, text.count <= 2048, seen.insert(text).inserted,
                  viewport.exists, !target.frame.isEmpty,
                  viewport.frame.insetBy(dx: -1, dy: -1).contains(target.frame),
                  app.frame.contains(viewport.frame)
            else {
                XCTFail("Failure page is empty, repeated, oversized or outside its native viewport")
                return
            }
            pages.append(text)
            let next = testCase.node(app, "medical-appointment-next-result")
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
            let advanced = XCTWaiter.wait(for: [changed], timeout: 10)
            observe(app, results: results, phase: "after-page-\(index)", testCase: testCase)
            guard advanced == .completed else {
                XCTFail("The failure reader did not advance to a distinct native page")
                return
            }
        }
        XCTFail("Failure document exceeded the bounded page inventory")
    }

    /// React parentage is not assumed to be the native AX hierarchy. Match the proven staged reader,
    /// then require unique identities and enclosing geometry rather than accepting arbitrary global text.
    private static func validStage(_ app: XCUIApplication, results: XCUIElement) -> Bool {
        let ids = ["medical-appointment-results", "classification-page-text", "classification-text-viewport",
                   "classification-circle-slot", "medical-appointment-import"]
        guard ids.allSatisfy({ app.descendants(matching: .any).matching(identifier: $0).count == 1 }),
              ["medical-appointment-confirmation", "medical-appointment-progress"].allSatisfy({
                  app.descendants(matching: .any).matching(identifier: $0).count == 0
              }), !results.frame.isEmpty, app.frame.contains(results.frame) else { return false }
        let viewport = UITestConditions.element(app, "classification-text-viewport")
        let footer = UITestConditions.element(app, "classification-stage-footer")
        guard !viewport.frame.isEmpty,
              results.frame.insetBy(dx: -1, dy: -1).contains(viewport.frame),
              UITestConditions.element(app, "classification-circle-slot").frame.insetBy(dx: -1, dy: -1)
                  .contains(UITestConditions.element(app, "medical-appointment-import").frame) else { return false }
        let controls = ["medical-appointment-previous-result", "medical-appointment-next-result"].map { UITestConditions.element(app, $0) }
        guard controls[0].exists == controls[1].exists else { return false }
        if !controls[0].exists { return true }
        return footer.exists && controls.allSatisfy { control in
            return control.frame.width >= 44 && control.frame.height >= 44
                && footer.frame.insetBy(dx: -1, dy: -1).contains(control.frame)
        }
    }

    /// Persist before every possible fail-fast assertion; defer is not reliable when XCTest aborts a case.
    private static func observe(_ app: XCUIApplication, results: XCUIElement, phase: String, testCase: AppointmentConsentUITests) {
        let ids = ["medical-appointment-results", "medical-appointment-confirmation", "medical-appointment-progress",
                   "classification-page-text", "classification-text-viewport", "classification-stage-footer",
                   "medical-appointment-previous-result", "medical-appointment-next-result"]
        let records: [[String: Any]] = ids.map { id in
            let query = app.descendants(matching: .any).matching(identifier: id)
            let targets: [[String: Any]] = query.allElementsBoundByIndex.prefix(2).compactMap { target in
                guard let snapshot = try? target.snapshot() else { return nil }
                return ["type": String(describing: snapshot.elementType), "frame": NSCoder.string(for: snapshot.frame),
                        "exists": target.exists, "enabled": snapshot.isEnabled, "hittable": target.isHittable,
                        "label": String(snapshot.label.prefix(2048)), "value": String((snapshot.value as? String ?? "").prefix(2048))]
            }
            return ["id": id, "globalCount": query.count,
                    "descendantCount": results.exists ? results.descendants(matching: .any).matching(identifier: id).count : 0,
                    "targets": targets]
        }
        if let data = try? JSONSerialization.data(withJSONObject: records, options: [.sortedKeys]) {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = "synthetic-classification-failure-\(phase)"
            attachment.lifetime = .keepAlways
            testCase.add(attachment)
        }
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
