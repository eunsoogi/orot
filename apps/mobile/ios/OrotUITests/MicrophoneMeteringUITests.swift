import XCTest

/// Observes the original RN event consumer and real microphone boundary; silence is valid, generated amplitudes are not.
final class MicrophoneMeteringUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testMeteringEventsPauseResumeAndExplicitCleanup() async throws {
        let app = XCUIApplication()
        defer { terminateStandaloneApp(app) }
        start(app, observePermission: true)
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
        status(app, "paused")
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
        status(app, "completed")
        let completed = dictionary(report(app, name: "microphone-explicit-stop"), "state")
        XCTAssertEqual(completed["cleanupComplete"] as? Bool, true)
        XCTAssertEqual(number(completed, "amplitude"), 0)
        XCTAssertEqual(completed["reason"] as? String, "explicit-stop")
    }

    @MainActor
    func testWallClockDeadlineEndsCaptureAndCleansItsArtifact() {
        let app = XCUIApplication()
        defer { terminateStandaloneApp(app) }
        start(app)
        status(app, "completed")
        let completed = dictionary(report(app, name: "microphone-wall-clock-deadline"), "state")
        XCTAssertEqual(completed["reason"] as? String, "timeout")
        XCTAssertEqual(completed["cleanupComplete"] as? Bool, true)
    }

    /// Fixture completion already uninstalls the owned app and verifies absence. Avoid a second
    /// XCTest termination acknowledgement; standalone invocations still own their app cleanup.
    @MainActor
    private func terminateStandaloneApp(_ app: XCUIApplication) {
        if ProcessInfo.processInfo.environment["OROT_IOS_FIXTURE_SESSION"] == nil {
            app.terminate()
        }
    }

    @MainActor
    private func start(_ app: XCUIApplication, observePermission: Bool = false) {
        app.launchArguments = ["-OROT_TEST_SCENARIO", "metering"]
        app.launch()
        status(app, "idle")
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
        XCTAssertEqual(UITestConditions.wait(for: [permissionOrRecording]), .completed, app.debugDescription)
        if alert.exists {
            let description = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
            XCTAssertTrue(description.localizedCaseInsensitiveContains("microphone") || description.contains("마이크"), description)
            let allow = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "허용", "OK", "확인"])).firstMatch
            XCTAssertTrue(allow.exists, alert.debugDescription)
            let permission = XCTAttachment(screenshot: springboard.screenshot())
            permission.name = "observed-microphone-system-permission"
            permission.lifetime = .keepAlways
            add(permission)
            if observePermission {
                attachPermissionObservation("before", app: app, springboard: springboard, alert: alert, allow: allow)
            }
            allow.tap()
            if observePermission {
                attachPermissionObservation("after", app: app, springboard: springboard, alert: alert, allow: allow)
            }
        }
        status(app, "recording")
    }

    /// Observe the original single tap without adding a readiness gate or retry. Reads can perturb timing.
    /// Successful dismissal can remove the button; that absence is diagnostic data, not an assertion failure.
    @MainActor
    private func attachPermissionObservation(_ phase: String, app: XCUIApplication, springboard: XCUIApplication, alert: XCUIElement, allow: XCUIElement) {
        let exists = allow.exists
        let snapshot = exists ? try? allow.snapshot() : nil
        var value: [String: Any] = [
            "phase": phase,
            "coordinateUnits": "points",
            "buttonExists": exists,
            "isHittable": allow.isHittable,
            "snapshotAvailable": snapshot != nil,
            "appState": app.state.rawValue,
            "springboardState": springboard.state.rawValue,
            "alertExists": alert.exists,
            "appWindowSnapshot": app.debugDescription,
            "springboardWindowSnapshot": springboard.debugDescription,
        ]
        if let snapshot {
            let frame = snapshot.frame
            value["label"] = snapshot.label
            value["enabled"] = snapshot.isEnabled
            value["frame"] = ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
        }
        let attachment = if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
            XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        } else {
            XCTAttachment(string: "Permission observation serialization failed: \(value)")
        }
        attachment.name = "microphone-permission-\(phase)"
        attachment.lifetime = .keepAlways
        add(attachment)
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
        XCTAssertTrue(UITestConditions.exists(target), app.debugDescription)
        target.tap()
    }

    @MainActor
    private func status(_ app: XCUIApplication, _ expected: String) {
        UITestConditions.value(node(app, "metering-status"), equals: expected)
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
