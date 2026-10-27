import XCTest

/// Covers the production import entry and keeps the active source scope through real geometry changes.
final class HealthImportDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testHealthRecordsLibraryOpensTheUnifiedImportRoute() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
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
            app.terminate()
        }

        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-open-health-library")
        NavigationUITestConditions.route(app, markers: ["health-records-title"])
        tap(app, "health-records-open-health-import")
        NavigationUITestConditions.route(app, markers: ["unified-import-scroll"])
        XCTAssertTrue(node(app, "unified-import-source-selection").exists, app.debugDescription)
        XCTAssertTrue(node(app, "unified-import-activity").exists, app.debugDescription)
        assertSupportingContentStaysInMeasuredRegions(app)
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { appearance = $0 })
        tap(app, "unified-import-toggle-heartRate")
        capture(app, "health-import-library-light")
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertTrue(node(app, "unified-import-toggle-heartRate").exists, app.debugDescription)
        capture(app, "health-import-library-dark")

        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["health-records-title"])
    }

    @MainActor
    func testSelectedSourcesAndPendingImportSurviveDuoGeometryChanges() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "unified-import",
            "-OROT_UNIFIED_IMPORT_PROBE", "cancellable",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer {
            XCUIDevice.shared.orientation = .portrait
            app.terminate()
        }

        UITestConditions.value(node(app, "unified-import-probe-status"), equals: "probe=ready;source=cancellable;systemSheets=not-observed")
        tap(app, "unified-import-toggle-heartRate")
        tap(app, "unified-import-toggle-steps")
        tap(app, "unified-import-start")
        UITestConditions.value(node(app, "unified-import-status"), equals: "preparingStorage")

        let sourcePanel = node(app, "unified-import-source-selection")
        let activityPanel = node(app, "unified-import-activity")
        XCTAssertTrue(sourcePanel.descendants(matching: .any).matching(identifier: "unified-import-toggle-heartRate").firstMatch.exists, app.debugDescription)
        XCTAssertTrue(activityPanel.descendants(matching: .any).matching(identifier: "unified-import-feature-status-heartRate").firstMatch.exists, app.debugDescription)
        XCTAssertFalse(sourcePanel.descendants(matching: .any).matching(identifier: "unified-import-feature-status-heartRate").firstMatch.exists, app.debugDescription)
        assertPanelsDoNotOverlap(app)
        assertSupportingContentStaysInMeasuredRegions(app)
        capture(app, "health-import-before-geometry-change")

        let scroll = node(app, "unified-import-scroll")
        let portraitWidth = scroll.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWidthChange(scroll, from: portraitWidth)
        assertSelectedRunIsRetained(app)
        assertPanelsDoNotOverlap(app)
        assertSupportingContentStaysInMeasuredRegions(app)
        capture(app, "health-import-landscape-pending")

        let landscapeWidth = scroll.frame.width
        XCUIDevice.shared.orientation = .portrait
        waitForWidthChange(scroll, from: landscapeWidth)
        assertSelectedRunIsRetained(app)
        assertPanelsDoNotOverlap(app)
        assertSupportingContentStaysInMeasuredRegions(app)

        tap(app, "unified-import-cancel")
        UITestConditions.value(node(app, "unified-import-status"), equals: "cancelled")
        UITestConditions.value(node(app, "unified-import-probe-cancellation-summary"), equals: "fakeFeatureRuns=0;queryOperations=0;persistenceOperations=0;syntheticStoredRecords=0")
    }

    @MainActor
    func testLargeTextUsesOneReadableColumnForThePendingImport() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "unified-import",
            "-OROT_UNIFIED_IMPORT_PROBE", "cancellable",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        defer { app.terminate() }

        UITestConditions.value(node(app, "unified-import-probe-status"), equals: "probe=ready;source=cancellable;systemSheets=not-observed")
        tap(app, "unified-import-toggle-heartRate")
        tap(app, "unified-import-start")
        UITestConditions.value(node(app, "unified-import-status"), equals: "preparingStorage")
        let source = node(app, "unified-import-columns-primary")
        let activity = node(app, "unified-import-columns-secondary")
        XCTAssertTrue(source.exists && activity.exists, app.debugDescription)
        XCTAssertLessThanOrEqual(abs(source.frame.minX - activity.frame.minX), 1, app.debugDescription)
        XCTAssertGreaterThanOrEqual(activity.frame.minY, source.frame.maxY, app.debugDescription)
        assertSupportingContentStaysInMeasuredRegions(app)
        capture(app, "health-import-large-text-pending")

        tap(app, "unified-import-cancel")
        UITestConditions.value(node(app, "unified-import-status"), equals: "cancelled")
    }

    @MainActor
    func testMedicationHistoryAndPeriodSurviveDuoReflow() throws {
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        defer {
            XCUIDevice.shared.orientation = originalOrientation
            app.terminate()
        }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "blood-pressure", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"]
        app.launch()

        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        tap(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])
        tap(app, "health-data-feature-bloodPressure")
        tap(app, "health-data-feature-medications")
        tap(app, "health-data-save")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        tap(app, "settings-open-sync-status")
        NavigationUITestConditions.route(app, markers: ["settings-sync-status-title"])
        UITestConditions.value(
            node(app, "settings-sync-status-message"),
            equals: "마지막 동기화에서 선택한 기록을 확인했어요.",
        )
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-open-health-library")
        NavigationUITestConditions.route(app, markers: ["health-records-title"])
        tap(app, "health-record-filter-medications")
        tap(app, "health-record-open-detail-medications")

        let period = node(app, "health-record-period-three_months")
        XCTAssertTrue(period.waitForAppearance(), app.debugDescription)
        period.tap()
        XCTAssertTrue(period.isSelected, app.debugDescription)
        let source = node(app, "health-record-medication-row-0-source")
        XCTAssertTrue(source.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(UITestConditions.text(source).contains("HealthKit"), app.debugDescription)
        let primary = node(app, "health-records-medication-detail-layout-primary")
        let secondary = node(app, "health-records-medication-detail-layout-secondary")
        XCTAssertTrue(primary.exists && secondary.exists, app.debugDescription)

        let before = app.windows.firstMatch.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWidthChange(app.windows.firstMatch, from: before)
        XCTAssertTrue(node(app, "health-record-period-three_months").isSelected, app.debugDescription)
        XCTAssertTrue(node(app, "health-record-medication-row-0-source").exists, app.debugDescription)
        XCTAssertFalse(primary.frame.intersects(secondary.frame), app.debugDescription)
        XCTAssertLessThanOrEqual(abs(primary.frame.minY - secondary.frame.minY), 1, app.debugDescription)
        XCTAssertLessThanOrEqual(primary.frame.maxX, secondary.frame.minX + 1, app.debugDescription)
        capture(app, "medication-history-landscape")
        let landscapeWidth = app.windows.firstMatch.frame.width
        XCUIDevice.shared.orientation = .portrait
        waitForWidthChange(app.windows.firstMatch, from: landscapeWidth)
        XCTAssertTrue(node(app, "health-record-period-three_months").isSelected, app.debugDescription)
        XCTAssertFalse(primary.frame.intersects(secondary.frame), app.debugDescription)
    }

    @MainActor
    private func assertSelectedRunIsRetained(_ app: XCUIApplication) {
        XCTAssertTrue(node(app, "unified-import-toggle-heartRate").exists, app.debugDescription)
        XCTAssertTrue(node(app, "unified-import-toggle-steps").exists, app.debugDescription)
        UITestConditions.value(node(app, "unified-import-status"), equals: "preparingStorage")
        XCTAssertTrue(node(app, "unified-import-cancel").exists, app.debugDescription)
    }

    @MainActor
    private func assertPanelsDoNotOverlap(_ app: XCUIApplication) {
        let source = node(app, "unified-import-columns-primary")
        let activity = node(app, "unified-import-columns-secondary")
        XCTAssertTrue(source.exists && activity.exists, app.debugDescription)
        XCTAssertFalse(source.frame.intersects(activity.frame), app.debugDescription)
    }

    @MainActor
    private func assertSupportingContentStaysInMeasuredRegions(_ app: XCUIApplication) {
        let sourceRegion = node(app, "unified-import-columns-primary")
        let activityRegion = node(app, "unified-import-columns-secondary")
        let title = node(app, "unified-import-title")
        let description = node(app, "unified-import-description")
        XCTAssertTrue(title.exists && description.exists, app.debugDescription)
        // Header and fallback controls must stay inside the same measured regions as their panels.
        XCTAssertTrue(sourceRegion.frame.contains(title.frame), app.debugDescription)
        XCTAssertTrue(sourceRegion.frame.contains(description.frame), app.debugDescription)
        // Shared navigation actions live outside this panel; inspect only screen fallbacks.
        let start = activityRegion.descendants(matching: .any).matching(identifier: "unified-import-start").firstMatch
        if start.exists {
            XCTAssertTrue(activityRegion.frame.contains(start.frame), app.debugDescription)
        }
        let cancel = activityRegion.descendants(matching: .any).matching(identifier: "unified-import-cancel").firstMatch
        if cancel.exists {
            XCTAssertTrue(activityRegion.frame.contains(cancel.frame), app.debugDescription)
        }
    }

    @MainActor
    private func waitForWidthChange(_ element: XCUIElement, from width: CGFloat) {
        let changed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                element.exists && abs(element.frame.width - width) > 0.5
            },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = node(app, identifier)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        UITestConditions.scrollTo(target, in: app)
        target.tap()
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
