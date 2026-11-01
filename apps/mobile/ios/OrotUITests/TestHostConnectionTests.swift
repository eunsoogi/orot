import XCTest

final class TestHostConnectionTests: OrotFailFastTestCase {
    /// Compare the same device request with Safari's public XCUI window, without reading browser content.
    @MainActor
    func testSystemBrowserRotationControl() throws {
        guard ProcessInfo.processInfo.environment["OROT_ROTATION_CONTROL"] == "YES" else {
            throw XCTSkip("Explicit rotation control opt-in required")
        }
        let browser = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCUIDevice.shared.orientation = .portrait
        browser.launch()
        defer { browser.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCTAssertEqual(browser.state, .runningForeground)
        let window = browser.windows.firstMatch
        XCTAssertTrue(window.exists)
        let initial = window.frame
        XCTAssertFalse(initial.isEmpty)
        let requestedAt = Date().timeIntervalSince1970 * 1000
        XCUIDevice.shared.orientation = .landscapeLeft
        var attempts = 0
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            attempts += 1
            let frame = window.frame
            if attempts == 1 || attempts == 100 || abs(frame.width - initial.width) > 0.5 {
                // Log scalar geometry only; Safari contents and browsing data are not read.
                print("OROT_BROWSER_ROTATION requestedAtMs=\(requestedAt) sampledAtMs=\(Date().timeIntervalSince1970 * 1000) bundle=com.apple.mobilesafari state=\(browser.state.rawValue) device=\(XCUIDevice.shared.orientation.rawValue) window=\(frame) initial=\(initial) attempt=\(attempts)")
            }
            return abs(frame.width - initial.width) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
    }

    /// A first connection check proves an actual XCUI runner can launch the app and read its test-only host.
    /// It is target wiring evidence, not the completed Speech or product journey.
    @MainActor
    func testHostLaunches() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_HOST", "YES"]
        app.launch()
        XCTAssertTrue(app.otherElements["integration-test-host"].waitForAppearance())
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "test-host"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
    }

    /// Records the first settings snapshot and existing geometry marker after the original AI route is visible.
    @MainActor
    func testInitialNavigationObservationOnAIJourney() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        try recordInitialObservationSnapshot(app)
    }

    /// Samples each marker's presence once without waiting and retains only allowlisted settings and geometry structure.
    @MainActor
    private func recordInitialObservationSnapshot(_ app: XCUIApplication) throws {
        let settingsMarker = UITestConditions.element(app, "test-entry-settings-observation")
        let navigationMarker = UITestConditions.element(app, "navigation-test-observation")
        let settingsMarkerPresent = settingsMarker.exists
        let navigationMarkerPresent = navigationMarker.exists
        var settingsSnapshot: [String: Any]?
        var evidence: [String: Any] = [
            "settingsSnapshotMarkerPresent": settingsMarkerPresent,
            "navigationObservationMarkerPresent": navigationMarkerPresent,
        ]

        if settingsMarkerPresent {
            let data = Data(settingsMarker.label.utf8)
            if let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                settingsSnapshot = snapshot
                evidence["initialTestEntryObservation"] = snapshot
            } else {
                evidence["initialTestEntryObservationReadable"] = false
            }
        }
        if navigationMarkerPresent {
            let data = Data(navigationMarker.label.utf8)
            if let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let lifecycle = snapshot["lifecycle"] as? [[String: Any]] ?? []
                var structure: [String: Any] = [
                    "topLevelKeys": snapshot.keys.sorted(),
                    "lifecycleEventCount": lifecycle.count,
                    "lifecycleEventNames": lifecycle.compactMap { $0["event"] as? String },
                ]
                if let windowGeometry = snapshot["windowGeometry"] as? [String: Any] {
                    structure["windowGeometryKeys"] = windowGeometry.keys.sorted()
                }
                evidence["navigationObservationStructure"] = structure
            } else {
                evidence["navigationObservationSnapshotReadable"] = false
            }
        }

        let attachmentData = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys])
        let attachment = XCTAttachment(data: attachmentData, uniformTypeIdentifier: "public.json")
        attachment.name = "initial-navigation-observation"
        attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: "Initial observation marker presence settings=\(settingsMarkerPresent) navigation=\(navigationMarkerPresent)") { _ in
            self.add(attachment)
        }

        XCTAssertTrue(settingsMarkerPresent, "The original AI journey must expose its initial settings snapshot")
        let snapshot = try XCTUnwrap(settingsSnapshot)
        XCTAssertEqual(snapshot["selectedRoute"] as? String, "ai-feature-visit-questions")
        XCTAssertTrue(snapshot["managerAvailable"] as? Bool == true)
        XCTAssertTrue(snapshot["settingsAvailable"] as? Bool == true)
        XCTAssertTrue(snapshot["lifecycleObservation"] as? Bool == true)
        XCTAssertTrue(snapshot["geometryObservation"] as? Bool == true)

        let flags = try XCTUnwrap(snapshot["flags"] as? [String: [String: Any]])
        for name in ["OROT_TEST_NAVIGATION_OBSERVATION", "OROT_TEST_UI_GEOMETRY"] {
            let flag = try XCTUnwrap(flags[name])
            XCTAssertEqual(flag["type"] as? String, "string")
            XCTAssertEqual(flag["value"] as? String, "YES")
        }
    }
}
