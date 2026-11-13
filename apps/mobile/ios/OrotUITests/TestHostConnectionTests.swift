import XCTest

final class TestHostConnectionTests: OrotFailFastTestCase {
    /// Capture separate native and AX geometry around one rotation request without waiting for a resize.
    @MainActor
    func testAppointmentRotationGeometryObservation() throws {
        let app = XCUIApplication()
        let session = UUID().uuidString
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "appointments", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_ROTATION_GEOMETRY_SESSION", session]
        app.launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCTAssertTrue(UITestConditions.element(app, "appointments-title").waitForAppearance())
        ViewportObservation.capture(app, entry: "appointments-rotation", stage: "before", testCase: self)
        let transition = UITestConditions.element(app, "rotation-transition-request")
        XCTAssertTrue(transition.exists && transition.isHittable)
        transition.tap()
        ViewportObservation.capture(app, entry: "appointments-rotation", stage: "armed", testCase: self)
        let armed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(transition.label.utf8)) as? [String: Any])
        XCTAssertEqual(armed["session"] as? String, session)
        XCTAssertEqual(armed["status"] as? String, "sampled")
        XCTAssertEqual(armed["mode"] as? String, "start")
        XCUIDevice.shared.orientation = .landscapeLeft
        transition.tap()
        let requestAt = Date().timeIntervalSince1970 * 1000
        let request = UITestConditions.element(app, "rotation-geometry-request")
        XCTAssertTrue(request.exists && request.isHittable)
        request.tap()
        ViewportObservation.capture(app, entry: "appointments-rotation", stage: "after-request", testCase: self)
        transition.tap()
        ViewportObservation.capture(app, entry: "appointments-rotation", stage: "after-transition-read", testCase: self)
        let transitionData = Data(transition.label.utf8)
        let transitionReceipt = try XCTUnwrap(JSONSerialization.jsonObject(with: transitionData) as? [String: Any])
        XCTAssertEqual(transitionReceipt["session"] as? String, session)
        XCTAssertEqual(transitionReceipt["mode"] as? String, "read")
        XCTAssertLessThanOrEqual(try XCTUnwrap(transitionReceipt["requestCount"] as? Int), 1)
        let transitionAttachment = XCTAttachment(data: transitionData, uniformTypeIdentifier: "public.json")
        transitionAttachment.name = "appointment-rotation-transition"
        transitionAttachment.lifetime = .keepAlways
        add(transitionAttachment)
        let axSample: [String: Any] = ["atMs": Date().timeIntervalSince1970 * 1000, "frame": ViewportObservation.rect(transition.frame)]
        let axAttachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: axSample), uniformTypeIdentifier: "public.json")
        axAttachment.name = "rotation-control-ax-frame"
        axAttachment.lifetime = .keepAlways
        add(axAttachment)
        // A terminal diagnostic must not report success when UIKit rejects or omits the scene change.
        XCTAssertTrue((transitionReceipt["error"] as? [String: Any])?.isEmpty == true, "Scene geometry request failed")
        XCTAssertFalse((transitionReceipt["events"] as? [[String: Any]] ?? []).isEmpty, "Scene geometry event was not observed")
        let data = Data(request.label.utf8)
        let receipt = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(receipt["requestId"] as? String, session)
        let requestedAt = try XCTUnwrap(receipt["requestedAtMs"] as? Double)
        let geometry = ViewportObservation.nativeGeometry(receipt)
        let started = try XCTUnwrap(geometry["sampleStartedAtMs"] as? Double)
        XCTAssertGreaterThanOrEqual(requestedAt, requestAt)
        XCTAssertGreaterThanOrEqual(started, requestedAt)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "appointment-rotation-fresh-native"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The exported geometry must not carry labels or other content from the native marker.
    @MainActor
    func testViewportObservationFiltersNativeMarker() {
        let geometry: [String: Any] = ["windowBounds": ["x": 0, "y": 0, "width": 320, "height": 700, "label": "private"], "safeAreaInsets": ["top": 44, "right": 0, "bottom": 0, "left": 0],
                                       "sceneOrientation": 1, "sampleStartedAtMs": 1, "sampleEndedAtMs": 2,
                                       "timestampUnits": "unix-milliseconds", "label": "private"]
        let filtered = ViewportObservation.nativeGeometry(["windowGeometry": geometry, "private": "content"])
        XCTAssertEqual(filtered["status"] as? String, "sampled")
        XCTAssertNil(filtered["label"])
        XCTAssertNil(filtered["private"])
        XCTAssertNil((filtered["windowBounds"] as? [String: Any])?["label"])
        XCTAssertTrue(Set(["navigation-keyboard-avoiding-root", "navigation-content-region", "navigation-root-tabs-glass-backdrop"]).isSubset(of: Set(ViewportObservation.identifiers)))
        XCTAssertEqual(Set(ViewportObservation.identifiers).count, ViewportObservation.identifiers.count)
        XCTAssertEqual(ViewportObservation.nativeGeometry([:])["status"] as? String, "unavailable")
        XCTAssertEqual(ViewportObservation.nativeGeometry(["windowGeometry": [:]])["status"] as? String, "incomplete")
    }

    /// Compare the same device request with Safari's public XCUI window, without reading browser content.
    @MainActor
    func testSystemBrowserRotationControl() throws {
        guard ProcessInfo.processInfo.environment["OROT_ROTATION_CONTROL"] == "YES" else {
            throw XCTSkip("Explicit rotation control opt-in required")
        }
        try observeRotationControl(bundle: "com.apple.mobilesafari", markerID: nil)
    }

    /// The disposable calibration app exposes only its own orientation and window metadata.
    @MainActor
    func testUIKitCalibrationRotationControl() throws {
        guard ProcessInfo.processInfo.environment["OROT_ROTATION_CALIBRATION"] == "YES" else {
            throw XCTSkip("Explicit UIKit calibration opt-in required")
        }
        try observeRotationControl(bundle: "org.orot.rotation-calibration", markerID: "rotation-calibration-observation")
    }

    @MainActor
    private func observeRotationControl(bundle: String, markerID: String?) throws {
        let browser = XCUIApplication(bundleIdentifier: bundle)
        XCUIDevice.shared.orientation = .portrait
        browser.launch()
        defer { browser.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCTAssertEqual(browser.state, .runningForeground)
        let window = browser.windows.firstMatch
        XCTAssertTrue(window.exists)
        let initial = window.frame
        XCTAssertFalse(initial.isEmpty)
        if let markerID {
            let marker = browser.staticTexts[markerID]
            XCTAssertTrue(marker.exists)
            print("OROT_CALIBRATION_BEFORE \(marker.value as? String ?? "unavailable")")
        }
        let requestedAt = Date().timeIntervalSince1970 * 1000
        XCUIDevice.shared.orientation = .landscapeLeft
        var attempts = 0
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            attempts += 1
            let frame = window.frame
            if attempts == 1 || attempts == 100 || abs(frame.width - initial.width) > 0.5 {
                // Log scalar geometry only; Safari contents and browsing data are not read.
                print("OROT_ROTATION_CONTROL requestedAtMs=\(requestedAt) sampledAtMs=\(Date().timeIntervalSince1970 * 1000) bundle=\(bundle) state=\(browser.state.rawValue) device=\(XCUIDevice.shared.orientation.rawValue) window=\(frame) initial=\(initial) attempt=\(attempts)")
                if let markerID {
                    let marker = browser.staticTexts[markerID]
                    print("OROT_CALIBRATION_OBSERVATION \(marker.value as? String ?? "unavailable")")
                }
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

        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")))
        try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
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
