import XCTest

/// A fresh fixture destination preserves the legacy-schema assertion without resetting shared Core records.
final class StorageMigrationUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testLegacyEncryptedSchemaReopensThroughAppointmentsAfterProcessRestart() {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_STORAGE_PROBE", "legacy"]
        app.launch()
        let success = UITestConditions.element(app, "storage-probe-legacy-success")
        let failure = UITestConditions.element(app, "storage-probe-legacy-failure")
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            success.exists || failure.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 30), .completed, app.debugDescription)
        XCTAssertTrue(success.exists, app.debugDescription)
        app.terminate()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "appointments"]
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "appointments-title"), equals: "예약")
        XCTAssertTrue(UITestConditions.element(app, "appointment-add").isHittable)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "appointments-after-legacy-schema-restart"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
