import XCTest

/// Keeps health-detail XCTest selectors stable while separating their scenarios from import tests.
extension HealthImportDuoUITests {
    /// Read-only synthetic pages measure content independently of rotation and keyboard synchronization.
    @MainActor
    func testSyntheticHealthLibraryAndDetailKeepContentBoundariesAtBothTextSizes() throws {
        for largeText in [false, true] {
            let app = XCUIApplication()
            app.launchArguments = [
                "-OROT_TEST_SCENARIO", "paged-records", "-OROT_TEST_UI_GEOMETRY", "YES",
                "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            ]
            if largeText {
                app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
            }
            app.launch()
            defer { app.terminate() }
            let size = largeText ? "large-text" : "default-text"
            try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
            try HealthRecordsBoundaryUITestConditions.tap(app, identifier: "records-open-health-library", owners: [.init(identifier: "navigation-route-scroll")], testCase: self)
            NavigationUITestConditions.route(app, markers: ["health-records-title"])
            try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["health-records-scroll"], name: "health-library-\(size)", testCase: self)
            try HealthRecordsBoundaryUITestConditions.tap(app, identifier: "health-record-filter-heart_rate", owners: [.init(identifier: "health-records-navigation-scroll"), .init(identifier: "health-record-category-filter", horizontal: true)], testCase: self)
            XCTAssertTrue(healthDetailNode(app, "health-record-filter-heart_rate").isSelected)
            try HealthRecordsBoundaryUITestConditions.tap(app, identifier: "health-record-open-detail-heart_rate", owners: [.init(identifier: "health-records-scroll")], testCase: self)
            NavigationUITestConditions.route(app, markers: ["health-records-detail-title"])
            try HealthRecordsBoundaryUITestConditions.tap(app, identifier: "health-record-period-year", owners: [.init(identifier: "health-records-detail-controls-scroll")], testCase: self)
            XCTAssertTrue(healthDetailNode(app, "health-record-period-year").isSelected)
            // Only the page loader supplies these nine session-only measurements; no personal HealthKit read is requested.
            UITestConditions.value(healthDetailNode(app, "health-record-row-0-value"), equals: "60 count/min")
            try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["health-records-detail-scroll"], name: "health-detail-\(size)", testCase: self)
            if largeText {
                XCTAssertGreaterThan(try NavigationGeometryUITestConditions.snapshot(app).fontScale, 1)
            }
            XCTAssertFalse(libraryIsActive(app, departing: "health-records-detail-scroll"))
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            waitForLibraryReturn(app, departing: "health-records-detail-scroll")
            XCTAssertTrue(healthDetailNode(app, "health-record-filter-heart_rate").isSelected)
            try HealthRecordsBoundaryUITestConditions.tap(app, identifier: "health-records-open-health-import", owners: [.init(identifier: "health-records-navigation-scroll")], testCase: self)
            NavigationUITestConditions.route(app, markers: ["unified-import-scroll"])
            XCTAssertTrue(healthDetailNode(app, "unified-import-source-selection").exists)
            XCTAssertTrue(healthDetailNode(app, "unified-import-activity").exists)
            // Observe entry and return without requesting authorization, selecting a source or starting an import.
            try NavigationGeometryUITestConditions.captureChildBoundary(app, viewportIDs: ["unified-import-scroll"], name: "health-import-entry-\(size)", testCase: self)
            XCTAssertFalse(libraryIsActive(app, departing: "unified-import-scroll"))
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            waitForLibraryReturn(app, departing: "unified-import-scroll")
            XCTAssertTrue(healthDetailNode(app, "health-record-filter-heart_rate").isSelected)
        }
    }

    /// Back retains the library's scroll position, so its offscreen heading is not an active-route predicate.
    @MainActor
    private func waitForLibraryReturn(_ app: XCUIApplication, departing identifier: String) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.libraryIsActive(app, departing: identifier)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
    }

    /// Reject a retained library behind a still-active detail/import scene; the original filter-state assertion follows return.
    @MainActor
    private func libraryIsActive(_ app: XCUIApplication, departing identifier: String) -> Bool {
        let library = healthDetailNode(app, "health-records-layout")
        let departing = healthDetailNode(app, identifier)
        let visible = app.windows.firstMatch.frame.intersection(healthDetailNode(app, "navigation-content-region").frame)
        return library.exists && !library.frame.isEmpty && library.frame.intersects(visible) && library.isHittable &&
            (!departing.exists || !departing.isHittable)
    }

    /// Retains the selected period and saved measurements when the native usable regions change.
    @MainActor
    func testHealthRecordPeriodAndRowsSurviveDuoGeometryChanges() throws {
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "paged-records", "-OROT_TEST_UI_GEOMETRY", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + AppearanceUITestConditions.observationArguments
        var appearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let appearance {
                do {
                    try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self)
                } catch {
                    XCTFail("Could not restore the owned Simulator's appearance: \(error)")
                }
            }
            XCUIDevice.shared.orientation = originalOrientation
            app.terminate()
        }

        // Start in portrait so the initial vertical layout assertion is deterministic.
        XCUIDevice.shared.orientation = .portrait
        app.launch()

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

    /// Retains the selected period and source label when medication history reflows on Duo.
    @MainActor
    func testMedicationHistoryAndPeriodSurviveDuoReflow() throws {
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        defer {
            XCUIDevice.shared.orientation = originalOrientation
            app.terminate()
        }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "blood-pressure", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"]
        // Start in portrait so the initial vertical layout assertion is deterministic.
        XCUIDevice.shared.orientation = .portrait
        app.launch()

        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        tapHealthDetail(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])
        tapHealthDetail(app, "health-data-feature-bloodPressure")
        tapHealthDetail(app, "health-data-feature-medications")
        tapHealthDetail(app, "health-data-save")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        tapHealthDetail(app, "settings-open-sync-status")
        NavigationUITestConditions.route(app, markers: ["settings-sync-status-title"])
        UITestConditions.value(
            healthDetailNode(app, "settings-sync-status-message"),
            equals: "마지막 동기화에서 선택한 기록을 확인했어요.",
        )
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tapHealthDetail(app, "records-open-health-library")
        NavigationUITestConditions.route(app, markers: ["health-records-title"])
        tapHealthDetail(app, "health-record-filter-medications")
        tapHealthDetail(app, "health-record-open-detail-medications")

        let period = healthDetailNode(app, "health-record-period-three_months")
        XCTAssertTrue(period.waitForAppearance(), app.debugDescription)
        period.tap()
        XCTAssertTrue(period.isSelected, app.debugDescription)
        let source = healthDetailNode(app, "health-record-medication-row-0-source")
        XCTAssertTrue(source.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(UITestConditions.text(source).contains("HealthKit"), app.debugDescription)
        let primary = healthDetailNode(app, "health-records-medication-detail-layout-primary")
        let secondary = healthDetailNode(app, "health-records-medication-detail-layout-secondary")
        XCTAssertTrue(primary.exists && secondary.exists, app.debugDescription)

        let before = app.windows.firstMatch.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForHealthDetailWidthChange(app.windows.firstMatch, from: before)
        XCTAssertTrue(healthDetailNode(app, "health-record-period-three_months").isSelected, app.debugDescription)
        XCTAssertTrue(healthDetailNode(app, "health-record-medication-row-0-source").exists, app.debugDescription)
        XCTAssertFalse(primary.frame.intersects(secondary.frame), app.debugDescription)
        XCTAssertLessThanOrEqual(abs(primary.frame.minY - secondary.frame.minY), 1, app.debugDescription)
        XCTAssertLessThanOrEqual(primary.frame.maxX, secondary.frame.minX + 1, app.debugDescription)
        captureHealthDetail(app, "medication-history-landscape")
        let landscapeWidth = app.windows.firstMatch.frame.width
        XCUIDevice.shared.orientation = .portrait
        waitForHealthDetailWidthChange(app.windows.firstMatch, from: landscapeWidth)
        XCTAssertTrue(healthDetailNode(app, "health-record-period-three_months").isSelected, app.debugDescription)
        XCTAssertFalse(primary.frame.intersects(secondary.frame), app.debugDescription)
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
