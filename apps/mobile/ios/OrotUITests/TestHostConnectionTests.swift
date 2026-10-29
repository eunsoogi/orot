import XCTest

final class TestHostConnectionTests: OrotFailFastTestCase {
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

    /// Captures the test entry's first native settings read without starting the product app or re-reading the bridge.
    @MainActor
    func testHostReportsInitialNavigationObservationSettings() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_HOST", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-OROT_TEST_UI_GEOMETRY", "YES",
        ]
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(app.otherElements["integration-test-host"].waitForAppearance())
        let marker = UITestConditions.element(app, "test-entry-settings-observation")
        guard marker.waitForExistence(timeout: 10) else {
            XCTFail("The idle test host must expose its initial SettingsManager snapshot")
            return
        }
        let snapshotData = Data(UITestConditions.text(marker).utf8)
        let snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: snapshotData) as? [String: Any])
        let attachmentData = try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys])
        let attachment = XCTAttachment(data: attachmentData, uniformTypeIdentifier: "public.json")
        attachment.name = "initial-test-entry-settings"
        attachment.lifetime = .keepAlways
        add(attachment)

        XCTAssertTrue(snapshot["managerAvailable"] as? Bool == true)
        XCTAssertTrue(snapshot["settingsAvailable"] as? Bool == true)
        XCTAssertTrue(["settings", "getConstants"].contains(snapshot["source"] as? String ?? ""))
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
