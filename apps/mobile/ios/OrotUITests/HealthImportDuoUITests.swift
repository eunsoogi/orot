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
    func testHealthDataSettingsReflowKeepsSelectionAndPermissionDisclosure() throws {
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_TEST_UI_GEOMETRY", "YES"]
            + AppearanceUITestConditions.observationArguments
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
        app.launch()

        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        tap(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])

        let page = app.scrollViews.matching(identifier: "health-data-scroll").firstMatch
        let feature = node(app, "health-data-feature-heartRate")
        let permission = node(app, "health-data-permission-status")
        XCTAssertTrue(feature.waitForAppearance(), app.debugDescription)
        // Observe RN's localized checkbox value without saving or starting HealthKit work.
        let initialValue = try XCTUnwrap(feature.value as? String)
        tap(app, "health-data-feature-heartRate", in: page)
        let selectedValue = try XCTUnwrap(feature.value as? String)
        XCTAssertNotEqual(selectedValue, initialValue, app.debugDescription)

        let layout = node(app, "health-data-layout")
        XCTAssertEqual(app.scrollViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "health-data-")).count, 1, app.debugDescription)
        // Both choices and final actions must belong to the same native scroll owner.
        XCTAssertTrue(page.descendants(matching: .any).matching(identifier: "health-data-feature-heartRate").firstMatch.exists, app.debugDescription)
        XCTAssertTrue(page.descendants(matching: .any).matching(identifier: "health-data-permission-status").firstMatch.exists, app.debugDescription)
        UITestConditions.scrollTo(node(app, "health-data-save"), in: page)
        _ = try AppearanceUITestConditions.select(
            false, returningTo: app, testCase: self, captureOriginal: { appearance = $0 },
        )
        XCTAssertEqual(feature.value as? String, selectedValue, app.debugDescription)
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertEqual(feature.value as? String, selectedValue, app.debugDescription)
        XCTAssertTrue(permission.exists, app.debugDescription)
        capture(app, "health-data-settings-dark")

        let portraitWidth = layout.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWidthChange(layout, from: portraitWidth)
        XCTAssertEqual(feature.value as? String, selectedValue, app.debugDescription)
        XCTAssertTrue(permission.exists, app.debugDescription)
        UITestConditions.scrollTo(node(app, "health-data-save"), in: page)
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
    private func tap(_ app: XCUIApplication, _ identifier: String, in scroll: XCUIElement? = nil) {
        let target = node(app, identifier)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        UITestConditions.scrollTo(target, in: scroll ?? app)
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
