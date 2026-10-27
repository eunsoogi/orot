import XCTest

/// Native OS receipts accompany UI actions; no fake delivery or request mutation is available.
@MainActor
enum ReminderJourneyObservation {
    struct Request: Decodable {
        let identifier: String
        let appointmentId: String
        let timeKey: String
        let userInfoKeys: [String]
        let title: String
        let body: String
        let nextTriggerAtMs: Double?
    }

    struct Receipt: Decodable {
        let atMs: Double
        let processID: Int
        let authorization: Int
        let pending: [Request]
        let fontScale: Double
        let contentSizeCategory: String
        let contrast: Int
        let systemDarkerColors: Bool
        let reduceTransparency: Bool
        let contrastStrategy: String
    }

    static func fresh(_ app: XCUIApplication, after: Date = Date(), stage: String, testCase: XCTestCase,
                      matching: (Receipt) -> Bool = { _ in true }) throws -> Receipt
    {
        let marker = UITestConditions.element(app, "reminder-os-observation")
        XCTAssertTrue(UITestConditions.exists(marker))
        while true {
            // Propagate an actual AX error immediately rather than hiding it as a missing receipt.
            let text = try marker.snapshot().label
            let data = Data(text.utf8)
            let status = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            if status?["status"] as? String == "failed" {
                throw NSError(domain: "ReminderObservation", code: 1, userInfo: [NSLocalizedDescriptionKey: "Actual OS observation failed"])
            }
            if status?["status"] as? String == "observed" {
                let receipt = try JSONDecoder().decode(Receipt.self, from: data)
                if receipt.atMs > after.timeIntervalSince1970 * 1000, matching(receipt) {
                    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                    attachment.name = stage + "-actual-os-requests"
                    attachment.lifetime = .keepAlways
                    testCase.add(attachment)
                    return receipt
                }
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        }
    }

    static func assertPending(_ app: XCUIApplication, id: String, start: Date, stage: String, testCase: XCTestCase) throws {
        let receipt = try fresh(app, stage: stage, testCase: testCase)
        XCTAssertEqual(receipt.authorization, 2)
        XCTAssertEqual(receipt.pending.count, 1)
        let request = try XCTUnwrap(receipt.pending.first)
        XCTAssertEqual(request.appointmentId, id)
        XCTAssertEqual(request.timeKey, "instant:\(Int64(start.timeIntervalSince1970 * 1000))")
        XCTAssertEqual(try XCTUnwrap(request.nextTriggerAtMs), start.addingTimeInterval(-3600).timeIntervalSince1970 * 1000, accuracy: 1)
        XCTAssertEqual(request.userInfoKeys, ["appointmentId", "timeKey"])
        XCTAssertEqual(request.title, "Orot")
        XCTAssertEqual(request.body, "준비할 내용을 확인해 보세요.")
    }

    static func allowFirstNotification(_ app: XCUIApplication, testCase: XCTestCase, diagnosticAction: Int? = nil) throws {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        XCTAssertTrue(UITestConditions.exists(alert))
        let text = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
        XCTAssertTrue(text.localizedCaseInsensitiveContains("notification") || text.contains("알림"), text)
        capture(springboard, "actual-notification-permission", testCase: testCase)
        let allow = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "허용"])).firstMatch
        XCTAssertTrue(allow.exists && allow.isHittable)
        allow.tap()
        if let diagnosticAction {
            try ReminderJourneyDiagnostic.awaitAction(app, after: diagnosticAction, testCase: testCase)
        }
        let scheduled = app.staticTexts["알림이 설정되었어요."]
        XCTAssertTrue(UITestConditions.exists(scheduled))
    }

    static func tapActualNotification(_ app: XCUIApplication, cold: Bool, testCase: XCTestCase) throws {
        if cold {
            app.terminate()
        } else {
            XCUIDevice.shared.press(.home)
        }
        let expected: XCUIApplication.State = cold ? .notRunning : .runningBackground
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.state == expected }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let body = springboard.staticTexts["준비할 내용을 확인해 보세요."]
        // Await the actual OS banner, not a sleep or an injected notification response.
        XCTAssertTrue(UITestConditions.exists(body))
        // The banner can enter AX before its arrival animation completes. This provisional five-second
        // readiness bound fails a missing or non-hittable delivered notification before any tap.
        let bannerReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in body.exists && body.isHittable }, object: nil)
        let readiness = XCTWaiter.wait(for: [bannerReady], timeout: 5.0)
        XCTAssertEqual(readiness, .completed)
        guard readiness == .completed else { return }
        XCTAssertTrue(body.isHittable)
        capture(springboard, cold ? "cold-os-notification" : "running-os-notification", testCase: testCase)
        body.tap()
        let foreground = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.state == .runningForeground }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [foreground]), .completed)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "appointment-preparation")))
    }

    static func selectHighContrast(_ app: XCUIApplication, testCase: XCTestCase) throws {
        // Use the public Settings UI, not a forced trait or a fabricated React Native palette.
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()
        for labels in [["Accessibility", "손쉬운 사용"], ["Display & Text Size", "디스플레이 및 텍스트 크기"]] {
            let row = settings.staticTexts.matching(NSPredicate(format: "label IN %@", labels)).firstMatch
            UITestConditions.scrollTo(row, in: settings)
            XCTAssertTrue(row.exists && row.isHittable)
            row.tap()
        }
        let toggle = settings.switches.matching(NSPredicate(format: "label IN %@", ["Increase Contrast", "대비 증가"])).firstMatch
        UITestConditions.scrollTo(toggle, in: settings)
        XCTAssertTrue(toggle.exists && toggle.isHittable)
        recordSwitchValue(toggle, stage: "high-contrast-before-conditional-tap", testCase: testCase)
        if toggle.value as? String != "1" {
            toggle.tap()
        }
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in toggle.value as? String == "1" }, object: nil)
        // This ten-second diagnostic cap preserves a non-completing predicate; it is not a Settings timing guarantee.
        let readiness = XCTWaiter.wait(for: [changed], timeout: 10.0)
        recordSwitchValue(toggle, stage: "high-contrast-observation-end", result: readiness, testCase: testCase)
        capture(settings, "actual-system-increase-contrast", testCase: testCase)
        app.activate()
        // Collect the actual fresh receipt before assertions so an off state or predicate timeout remains observable.
        let receipt = try fresh(app, stage: "high-contrast-system", testCase: testCase)
        XCTAssertEqual(receipt.contrast, 2)
        XCTAssertTrue(receipt.systemDarkerColors)
        XCTAssertEqual(receipt.contrastStrategy, "system-accessibility-setting")
        capture(app, "actual-high-contrast-application", testCase: testCase)
        XCTAssertEqual(readiness, .completed)
    }

    /// Preserve raw values and types rather than interpreting a failed String comparison as an off switch.
    private static func recordSwitchValue(_ toggle: XCUIElement, stage: String, result: XCTWaiter.Result? = nil, testCase: XCTestCase) {
        let value = toggle.value
        let valueType = value.map { String(reflecting: type(of: $0)) } ?? "nil"
        let waitDetails = result.map { "\nwaitCompleted=\($0 == .completed)\nwaitTimedOut=\($0 == .timedOut)\nwaitResult=\($0.rawValue)" } ?? ""
        let attachment = XCTAttachment(string: "value=\(String(reflecting: value))\ntype=\(valueType)" + waitDetails)
        attachment.name = stage + "-switch-value"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    static func capture(_ app: XCUIApplication, _ name: String, testCase: XCTestCase) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }
}
