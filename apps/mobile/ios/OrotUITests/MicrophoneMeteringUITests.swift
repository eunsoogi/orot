import XCTest

/// Observes the original RN event consumer and real microphone boundary; silence is valid, generated amplitudes are not.
final class MicrophoneMeteringUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testNativeEventsPauseResumeAndExplicitCleanup() async throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        start(app)
        // These are the original measured capture windows, not sleeps used to infer readiness.
        try await Task.sleep(for: .seconds(3))
        let initial = report(app, name: "microphone-initial")
        let samples = dictionary(dictionary(initial, "statistics"), "initial")
        XCTAssertGreaterThan(number(samples, "samples"), 0)
        XCTAssertGreaterThanOrEqual(number(samples, "min"), 0)
        XCTAssertLessThanOrEqual(number(samples, "max"), 1)
        let initialState = dictionary(initial, "state")
        XCTAssertEqual(initialState["unlinked"] as? Bool, true)
        XCTAssertEqual(initialState["excludedFromBackup"] as? Bool, true)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "actual-microphone-waveform"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        tap(app, "metering-pause")
        status(app, "paused", timeout: 5)
        let paused = dictionary(report(app, name: "microphone-paused"), "state")
        try await Task.sleep(for: .seconds(1))
        let after = report(app, name: "microphone-paused-after-window")
        XCTAssertEqual(number(dictionary(after, "state"), "ticks"), number(paused, "ticks"))
        XCTAssertEqual(number(dictionary(after, "state"), "amplitude"), 0)
        XCTAssertEqual(number(dictionary(after, "statistics"), "pausedNonzero"), 0)
        tap(app, "metering-resume")
        try await Task.sleep(for: .seconds(3))
        let resumed = report(app, name: "microphone-resumed")
        XCTAssertGreaterThan(number(dictionary(dictionary(resumed, "statistics"), "resumed"), "samples"), 0)
        XCTAssertGreaterThan(number(dictionary(resumed, "state"), "ticks"), number(paused, "ticks"))
        tap(app, "metering-finish")
        status(app, "completed", timeout: 5)
        let completed = dictionary(report(app, name: "microphone-explicit-stop"), "state")
        XCTAssertEqual(completed["cleanupComplete"] as? Bool, true)
        XCTAssertEqual(number(completed, "amplitude"), 0)
        XCTAssertEqual(completed["reason"] as? String, "explicit-stop")
    }

    @MainActor
    func testWallClockDeadlineEndsCaptureAndCleansItsArtifact() {
        let app = XCUIApplication()
        defer { app.terminate() }
        start(app)
        status(app, "completed", timeout: 30)
        let completed = dictionary(report(app, name: "microphone-wall-clock-deadline"), "state")
        XCTAssertEqual(completed["reason"] as? String, "timeout")
        XCTAssertEqual(completed["cleanupComplete"] as? Bool, true)
    }

    @MainActor
    private func start(_ app: XCUIApplication) {
        app.launchArguments = ["-OROT_TEST_SCENARIO", "metering"]
        app.launch()
        status(app, "idle", timeout: 120)
        DebugUITestConditions.dismissWarningToast(app)
        XCTAssertFalse(node(app, "metering-start").isEnabled)
        tap(app, "metering-consent")
        XCTAssertTrue(node(app, "metering-start").isEnabled)
        tap(app, "metering-start")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        // The OS sheet can appear after the tap completes. Wait for that boundary or actual capture, not an early idle snapshot.
        let permissionOrRecording = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            alert.exists || UITestConditions.text(self.node(app, "metering-status")) == "recording"
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [permissionOrRecording], timeout: 20), .completed, app.debugDescription)
        if alert.exists {
            let description = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
            XCTAssertTrue(description.localizedCaseInsensitiveContains("microphone") || description.contains("마이크"), description)
            let allow = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "허용", "OK", "확인"])).firstMatch
            XCTAssertTrue(allow.exists, alert.debugDescription)
            let permission = XCTAttachment(screenshot: springboard.screenshot())
            permission.name = "observed-microphone-system-permission"
            permission.lifetime = .keepAlways
            add(permission)
            allow.tap()
        }
        status(app, "recording", timeout: 20)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        // This probe exposes buttons and static text directly. Avoid full-tree
        // queries inside its unchanged 25-second wall-clock capture boundary.
        if ["metering-start", "metering-consent", "metering-pause", "metering-resume", "metering-finish"].contains(id) {
            return app.buttons.matching(identifier: id).firstMatch
        }
        return app.staticTexts.matching(identifier: id).firstMatch
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(UITestConditions.exists(target, timeout: 10), app.debugDescription)
        target.tap()
    }

    @MainActor
    private func status(_ app: XCUIApplication, _ expected: String, timeout: TimeInterval) {
        UITestConditions.value(node(app, "metering-status"), equals: expected, timeout: timeout)
    }

    @MainActor
    private func report(_ app: XCUIApplication, name: String) -> [String: Any] {
        // The RN Text accessibilityLabel contains the complete JSON. Reading
        // value first creates another AX snapshot on every timed observation.
        let raw = node(app, "metering-report").label
        let data = Data(raw.utf8)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            XCTFail("The actual event report must contain JSON: \(raw)")
            return [:]
        }
        return value
    }

    private func dictionary(_ value: [String: Any], _ key: String) -> [String: Any] {
        guard let nested = value[key] as? [String: Any] else { XCTFail("Missing report object: \(key)"); return [:] }
        return nested
    }

    private func number(_ value: [String: Any], _ key: String) -> Double {
        guard let result = value[key] as? NSNumber else { XCTFail("Missing report number: \(key)"); return .nan }
        return result.doubleValue
    }
}
