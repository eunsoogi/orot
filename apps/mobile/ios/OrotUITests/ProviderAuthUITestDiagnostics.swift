import XCTest

/// Preserves the original consent oracle while retaining only secret-free state on failure.
@MainActor
enum ProviderAuthUITestDiagnostics {
    /// The native summary combines title, model, and status with layout newlines in one accessible label.
    static func selectionSummary(_ app: XCUIApplication, scroll: XCUIElement, expected: String, testCase: XCTestCase) throws {
        let summary = scroll.descendants(matching: .any).matching(identifier: "provider-selection-current").firstMatch
        XCTAssertTrue(UITestConditions.exists(summary), app.debugDescription)
        FormUITestConditions.reveal(summary, in: app, scroll: scroll, requireHittable: false, windowResolver: {
            let page = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "provider-selection-screen")).firstMatch
            return FormWindowOwnership.resolve(app, scroll: page, target: summary)
        })
        let actual = UITestConditions.text(summary)
        XCTAssertEqual(actual.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " "), expected)
        try RenderedTextUITestConditions.verify(summary, equals: actual, in: app, testCase: testCase)
    }

    /// Prove the tagged page and the exact message share one window before every measured gesture.
    static func selectionMessageWindow(_ app: XCUIApplication, text: String, role: XCUIElement.ElementType?) -> XCUIElement? {
        let windows = app.windows.allElementsBoundByIndex.filter(\.exists)
        let predicate = NSPredicate(format: "label == %@", text)
        func leaves(_ root: XCUIElement) -> [XCUIElement] {
            root.descendants(matching: role ?? .any).matching(predicate).allElementsBoundByIndex.filter {
                $0.descendants(matching: role ?? .any).matching(predicate).count == 0
            }
        }
        let pagePredicate = NSPredicate(format: "identifier == %@", "provider-selection-screen")
        let pageCounts = windows.map { $0.descendants(matching: .any).matching(pagePredicate).count }
        guard let owner = FormScrollGeometry.uniqueOwnerIndex(pageCounts) else {
            XCTFail("Provider page window is not unique: \(pageCounts)")
            return nil
        }
        let page = windows[owner].descendants(matching: .any).matching(pagePredicate).firstMatch
        let scrolls = page.scrollViews
        let targetCounts = windows.map { leaves($0).count }
        guard scrolls.count == 1, scrolls.firstMatch.scrollViews.count == 0,
              scrolls.firstMatch.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "provider-selection-footer")).count == 1,
              FormScrollGeometry.uniqueOwnerIndex(targetCounts) == owner,
              leaves(scrolls.firstMatch).count == 1
        else {
            XCTFail("Provider message ownership is ambiguous: page=\(pageCounts), target=\(targetCounts)")
            return nil
        }
        return windows[owner]
    }

    enum Stage: String {
        case firstNativeCancellation = "first-native-cancellation"
        case secondNativeReturn = "second-native-return"
    }

    /// Keeps the existing synthetic callback on screen while the app window reports a measured Duo reflow.
    static func continueLocalConsentDuringDuoReflow(_ app: XCUIApplication, testCase: XCTestCase) throws {
        // A fresh Simulator may report unknown; establish a measurable portrait baseline before consent.
        XCUIDevice.shared.orientation = .portrait
        let portrait = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.frame.width < app.frame.height }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [portrait]), .completed, app.debugDescription)
        let originalFrame = app.frame
        let callbackResult = app.staticTexts["로그인을 확인했어요. 모델 목록을 확인하려면 다시 눌러 주세요."]
        try continueLocalConsent(app, stage: .secondNativeReturn, testCase: testCase) {
            defer { XCUIDevice.shared.orientation = .portrait }
            XCUIDevice.shared.orientation = .landscapeLeft
            // The callback and width change may finish in either order; both must be visible before this path continues.
            let returnedDuringReflow = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let frame = app.frame
                return abs(frame.width - originalFrame.width) > 0.5
                    && frame.width > frame.height
                    && callbackResult.exists
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [returnedDuringReflow]), .completed, app.debugDescription)

            XCUIDevice.shared.orientation = .portrait
            let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let frame = app.frame
                return abs(frame.width - originalFrame.width) <= 0.5
                    && abs(frame.height - originalFrame.height) <= 0.5
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [restored]), .completed, app.debugDescription)
        }
    }

    static func continueLocalConsent(
        _ app: XCUIApplication,
        stage: Stage,
        testCase: XCTestCase,
        afterConsentTap: () throws -> Void = {},
    ) throws {
        let stage = stage.rawValue
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let presented = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.alerts.firstMatch.exists || springboard.alerts.firstMatch.exists
        }, object: nil)
        AuthConsentWait.observe(
            now: { ProcessInfo.processInfo.systemUptime },
            before: { capture(app, springboard, stage: stage + "-before-wait", testCase: testCase) },
            wait: { UITestConditions.wait(for: [presented]) },
            retain: { receipt in
                // This attachment performs no accessibility query and survives a later failed or stalled snapshot.
                attach(["stage": stage + "-wait-result", "waitResult": receipt.result.rawValue,
                        "waitSeconds": receipt.elapsedSeconds],
                       stage: stage + "-wait-result", testCase: testCase)
            },
            after: { capture(app, springboard, stage: stage + "-after-wait", testCase: testCase) },
            validate: { receipt in
                XCTAssertEqual(receipt.result, .completed)
            },
        )
        let alert = app.alerts.firstMatch.exists ? app.alerts.firstMatch : springboard.alerts.firstMatch
        let text = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
        XCTAssertTrue(text.contains("127.0.0.1") || text.contains("localhost"), "Consent must name the loopback host")
        let consent = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Continue", "계속"])).firstMatch
        XCTAssertTrue(consent.exists && consent.isHittable, "Consent must offer a hittable Continue button")
        consent.tap()
        try afterConsentTap()
    }

    /// Observe known process states and allowlisted alert facts, never screenshots, URLs or a web accessibility tree.
    private static func capture(_ app: XCUIApplication, _ springboard: XCUIApplication, stage: String,
                                testCase: XCTestCase)
    {
        let observation: [String: Any] = [
            "stage": stage,
            "uptimeSeconds": ProcessInfo.processInfo.systemUptime,
            "appState": app.state.rawValue,
            "springboardState": springboard.state.rawValue,
            "safariViewServiceState": XCUIApplication(bundleIdentifier: "com.apple.SafariViewService").state.rawValue,
            "mobileSafariState": XCUIApplication(bundleIdentifier: "com.apple.mobilesafari").state.rawValue,
            "appAlert": alertFacts(app.alerts.firstMatch),
            "springboardAlert": alertFacts(springboard.alerts.firstMatch),
        ]
        attach(observation, stage: stage, testCase: testCase)
    }

    private static func attach(_ observation: [String: Any], stage: String, testCase: XCTestCase) {
        guard let data = try? JSONSerialization.data(withJSONObject: observation, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8)
        else {
            XCTFail("Could not encode secret-free authentication observation")
            return
        }
        let attachment = XCTAttachment(string: text)
        attachment.name = "auth-consent-" + stage
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    private static func alertFacts(_ alert: XCUIElement) -> [String: Bool] {
        guard alert.exists else { return ["exists": false] }
        let text = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
        let consent = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Continue", "계속"])).firstMatch
        return [
            "exists": true,
            "namesLoopbackHost": text.contains("127.0.0.1") || text.contains("localhost"),
            "continueExists": consent.exists,
            "continueHittable": consent.exists && consent.isHittable,
        ]
    }
}
