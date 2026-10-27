import XCTest

/// Keeps the health-detail XCTest selector stable while separating its scenario from import tests.
extension HealthImportDuoUITests {
    /// Retains the selected period and saved measurements when the native usable regions change.
    @MainActor
    func testHealthRecordPeriodAndRowsSurviveDuoGeometryChanges() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "paged-records", "-OROT_TEST_UI_GEOMETRY", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + AppearanceUITestConditions.observationArguments
        app.launch()
        var appearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let appearance {
                do {
                    try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self)
                } catch {
                    XCTFail("Could not restore the owned Simulator's appearance: \(error)")
                }
            }
            XCUIDevice.shared.orientation = .portrait
            app.terminate()
        }

        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tapHealthDetail(app, "records-open-health-library")
        NavigationUITestConditions.route(app, markers: ["health-records-title"])
        tapHealthDetail(app, "health-record-open-detail-heart_rate")
        NavigationUITestConditions.route(app, markers: ["health-records-detail-title"])

        let layout = healthDetailNode(app, "health-records-detail-layout")
        let controls = healthDetailNode(app, "health-records-detail-layout-primary")
        let records = healthDetailNode(app, "health-records-detail-layout-secondary")
        let period = healthDetailNode(app, "health-record-period-year")
        let value = healthDetailNode(app, "health-record-row-0-value")
        XCTAssertTrue(layout.exists && controls.exists && records.exists, app.debugDescription)
        XCTAssertTrue(value.waitForAppearance(), app.debugDescription)
        XCTAssertGreaterThanOrEqual(records.frame.minY, controls.frame.maxY, app.debugDescription)
        period.tap()
        XCTAssertTrue(period.isSelected, app.debugDescription)
        UITestConditions.value(value, equals: "72 count/min")
        captureHealthDetail(app, "health-record-detail-light")

        let portraitWidth = layout.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForHealthDetailWidthChange(layout, from: portraitWidth)
        XCTAssertGreaterThanOrEqual(records.frame.minX, controls.frame.maxX, app.debugDescription)
        XCTAssertTrue(period.isSelected, app.debugDescription)
        UITestConditions.value(value, equals: "72 count/min")
        _ = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
            captureOriginal: { appearance = $0 },
        )
        XCTAssertTrue(period.isSelected, app.debugDescription)
        XCTAssertTrue(value.exists, app.debugDescription)
        captureHealthDetail(app, "health-record-detail-dark")
    }

    @MainActor
    private func healthDetailNode(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }

    @MainActor
    private func tapHealthDetail(_ app: XCUIApplication, _ identifier: String) {
        let target = healthDetailNode(app, identifier)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        UITestConditions.scrollTo(target, in: app)
        target.tap()
    }

    @MainActor
    private func waitForHealthDetailWidthChange(_ element: XCUIElement, from width: CGFloat) {
        let changed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                element.exists && abs(element.frame.width - width) > 0.5
            },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed)
    }

    @MainActor
    private func captureHealthDetail(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
