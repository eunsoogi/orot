import XCTest

/// Keeps fixture authorization timings separate from permission-sheet visibility and personal HealthKit access.
final class UnifiedImportUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testProviderSelectionUsesTheRealRecordsRouteAcrossAppearanceChangesBeforeImport() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        app.launch()
        var appearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let appearance {
                do {
                    try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self)
                } catch { XCTFail("Could not restore the owned Simulator's appearance: \(error)") }
            }
            app.terminate()
        }
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { appearance = $0 })
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        XCTAssertTrue(node(app, "records-new-recording").exists)
        XCTAssertTrue(node(app, "records-open-health-library").exists)
        XCTAssertFalse(node(app, "records-health-import").exists)
        XCTAssertFalse(node(app, "records-open-common-observations").exists)
        XCTAssertFalse(node(app, "records-open-blood-pressure").exists)
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        let action = node(app, "settings-open-health-data")
        FormUITestConditions.reveal(action, in: app, scrollID: "navigation-route-scroll")
        action.tap()
        NavigationUITestConditions.route(app, markers: ["health-data-scroll"])
        XCTAssertTrue(node(app, "health-data-title").exists)
        let save = node(app, "health-data-save")
        XCTAssertTrue(UITestConditions.exists(save))
        XCTAssertGreaterThanOrEqual(save.frame.width, 44)
        XCTAssertGreaterThanOrEqual(save.frame.height, 44)
        let medication = node(app, "health-data-feature-medications")
        XCTAssertTrue(medication.exists && medication.isHittable)
        XCTAssertGreaterThanOrEqual(medication.frame.height, 44)
        XCTAssertFalse(node(app, "unified-import-start").exists)
        capture(app, "health-data-light")
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertTrue(node(app, "health-data-feature-bloodPressure").isHittable)
        capture(app, "health-data-dark")
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "health-data-scroll", contentID: "health-data-save")
        // The route test only observes compact controls; it never saves an opt-in or requests personal records.
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
    }

    @MainActor
    func testSyntheticConsentMeasurementsAndExplicitCalendarConfirmation() {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, mode: "synthetic")
        let features = ["medications", "bloodPressure", "sleep", "heartRate", "steps", "bodyMass"]
        for feature in features {
            tap(app, "unified-import-toggle-\(feature)")
        }
        tap(app, "unified-import-toggle-eventKit")
        tap(app, "unified-import-start")
        terminal(app, id: "unified-import-status", allowed: ["complete", "empty"])
        for feature in features {
            terminal(app, id: "unified-import-feature-status-\(feature)", allowed: ["complete", "empty"])
        }
        XCTAssertTrue(node(app, "unified-import-eventkit-candidate-0").exists)
        tap(app, "unified-import-eventkit-select-0")
        tap(app, "unified-import-eventkit-confirm")
        XCTAssertTrue(node(app, "unified-import-eventkit-confirmed").waitForAppearance())
        let summary = UITestConditions.text(node(app, "unified-import-probe-measurements"))
        XCTAssertNotNil(summary.range(of: measurementPattern(), options: .regularExpression), summary)
        capture(app, "unified-import-explicit-synthetic-confirmation")
    }

    @MainActor
    func testCancellationPreventsQueriesAndPersistenceBeforeSameSelectionRetry() {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, mode: "cancellable")
        let features = ["heartRate", "steps"]
        for feature in features {
            tap(app, "unified-import-toggle-\(feature)")
        }
        tap(app, "unified-import-start")
        UITestConditions.value(node(app, "unified-import-status"), equals: "preparingStorage")
        XCTAssertTrue(node(app, "unified-import-cancel").waitForAppearance())
        // The gate is released after run.cancel(), so no query or write may begin before cancellation.
        tap(app, "unified-import-cancel")
        UITestConditions.value(node(app, "unified-import-status"), equals: "cancelled")
        for feature in features {
            UITestConditions.value(node(app, "unified-import-feature-status-\(feature)"), equals: "cancelled")
        }
        UITestConditions.value(node(app, "unified-import-probe-cancellation-summary"), equals: "fakeFeatureRuns=0;queryOperations=0;persistenceOperations=0;syntheticStoredRecords=0")
        capture(app, "unified-import-cancel-before-write")
        tap(app, "unified-import-start")
        UITestConditions.value(node(app, "unified-import-status"), equals: "complete")
        for feature in features {
            UITestConditions.value(node(app, "unified-import-feature-status-\(feature)"), equals: "complete")
        }
        UITestConditions.value(node(app, "unified-import-probe-cancellation-summary"), equals: "fakeFeatureRuns=2;queryOperations=2;persistenceOperations=2;syntheticStoredRecords=2")
        capture(app, "unified-import-same-selection-retry")
    }

    private func measurementPattern() -> String {
        let keys = [
            "healthKitAuthorizationCalls", "healthKitAuthorizationStartOffsetMs", "healthKitRequestInvocationOffsetMs", "healthKitAuthorizationFinishedOffsetMs", "healthKitAuthorizationMs",
            "eventKitAuthorizationCalls", "eventKitAuthorizationStartOffsetMs", "eventKitRequestInvocationOffsetMs", "eventKitAuthorizationFinishedOffsetMs", "eventKitAuthorizationMs",
            "healthKitQueryCalls", "healthKitQueryStartOffsetMs", "healthKitQueryFinishedOffsetMs", "healthKitQueryMs",
            "eventKitQueryCalls", "eventKitQueryStartOffsetMs", "eventKitQueryFinishedOffsetMs", "eventKitQueryMs",
            "healthKitPersistenceOperations", "healthKitPersistenceStartOffsetMs", "healthKitPersistenceFinishedOffsetMs", "healthKitPersistenceMs",
            "eventKitPersistenceOperations", "eventKitPersistenceStartOffsetMs", "eventKitPersistenceFinishedOffsetMs", "eventKitPersistenceMs",
            "localStorePreparationStartOffsetMs", "localStorePreparationFinishedOffsetMs", "localStorePreparationMs",
        ]
        let singleCalls = ["healthKitAuthorizationCalls", "eventKitAuthorizationCalls", "eventKitQueryCalls"]
        return keys.map { $0 + "=" + (singleCalls.contains($0) ? "1" : #"\d+"#) }.joined(separator: ";")
    }

    @MainActor
    private func launch(_ app: XCUIApplication, mode: String) {
        app.launchArguments = ["-OROT_TEST_SCENARIO", "unified-import", "-OROT_UNIFIED_IMPORT_PROBE", mode]
        app.launch()
        UITestConditions.value(node(app, "unified-import-probe-status"), equals: "probe=ready;source=\(mode);systemSheets=not-observed")
        DebugUITestConditions.dismissWarningToast(app)
        let scroll = node(app, "unified-import-scroll")
        XCTAssertTrue(scroll.exists && scroll.frame.height > 0, app.debugDescription)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func terminal(_ app: XCUIApplication, id: String, allowed: [String]) {
        let target = node(app, id)
        let completed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            target.exists && allowed.contains(UITestConditions.text(target))
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [completed]), .completed, app.debugDescription)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        let scroll = node(app, "unified-import-scroll")
        // The diagnostics reduce this standalone viewport; an app-wide swipe can miss the actual ScrollView entirely.
        FormUITestConditions.reveal(target, in: app, scrollID: "unified-import-scroll",
                                    towardTop: target.frame.minY < scroll.frame.minY)
        target.tap()
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
