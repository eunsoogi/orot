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
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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
        let action = node(app, "records-health-import")
        FormUITestConditions.reveal(action, in: app, scrollID: "navigation-route-scroll")
        action.tap()
        NavigationUITestConditions.route(app, markers: ["unified-import-scroll"])
        let title = app.staticTexts.matching(NSPredicate(format: "label == %@", "건강 기록 가져오기")).firstMatch
        XCTAssertTrue(title.exists)
        let start = app.buttons.matching(identifier: "unified-import-start").firstMatch
        XCTAssertTrue(UITestConditions.exists(start))
        let surface = node(app, "navigation-toolbar")
        XCTAssertTrue(surface.exists && surface.frame.contains(start.frame))
        XCTAssertGreaterThanOrEqual(start.frame.width, 44)
        XCTAssertGreaterThanOrEqual(start.frame.height, 44)
        // Keep the original readonly state assertion on the actual native button; its containing UIKit surface can differ between navigation implementations.
        let candidates = app.buttons.matching(identifier: "unified-import-start").allElementsBoundByIndex
        let observations: [[String: Any]] = candidates.map { ["label": $0.label, "enabled": $0.isEnabled, "hittable": $0.isHittable, "x": $0.frame.minX, "y": $0.frame.minY, "width": $0.frame.width, "height": $0.frame.height] }
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: observations), uniformTypeIdentifier: "public.json")
        attachment.name = "import-button-before-selection"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertFalse(start.isEnabled, app.debugDescription)
        tap(app, "unified-import-toggle-healthKit")
        XCTAssertTrue(start.isEnabled)
        try captureNavigationStart(app, "import-button-after-selection")
        capture(app, "unified-import-light")
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        FormUITestConditions.reveal(node(app, "unified-import-toggle-eventKit"), in: app, scrollID: "unified-import-scroll")
        XCTAssertTrue(node(app, "unified-import-toggle-eventKit").isHittable)
        capture(app, "unified-import-dark")
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "unified-import-scroll", contentID: "unified-import-status")
        // Clearing the same selection must restore the native disabled state and leave no pending import to discard.
        tap(app, "unified-import-toggle-healthKit")
        XCTAssertFalse(start.isEnabled, app.debugDescription)
        try captureNavigationStart(app, "import-button-after-clear")
        // Selection remains local. Do not invoke the import action or request personal records in this route test.
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
    }

    @MainActor
    private func captureNavigationStart(_ app: XCUIApplication, _ name: String) throws {
        let values: [[String: Any]] = app.buttons.matching(identifier: "unified-import-start").allElementsBoundByIndex.map {
            ["label": $0.label, "enabled": $0.isEnabled, "hittable": $0.isHittable, "x": $0.frame.minX, "y": $0.frame.minY, "width": $0.frame.width, "height": $0.frame.height]
        }
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: values), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
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
        terminal(app, id: "unified-import-status", allowed: ["complete", "empty"], timeout: 240)
        for feature in features {
            terminal(app, id: "unified-import-feature-status-\(feature)", allowed: ["complete", "empty"], timeout: 30)
        }
        XCTAssertTrue(node(app, "unified-import-eventkit-candidate-0").exists)
        tap(app, "unified-import-eventkit-select-0")
        tap(app, "unified-import-eventkit-confirm")
        XCTAssertTrue(node(app, "unified-import-eventkit-confirmed").waitForExistence(timeout: 30))
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
        XCTAssertTrue(node(app, "unified-import-cancel").waitForExistence(timeout: 10))
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
        UITestConditions.value(node(app, "unified-import-probe-status"), equals: "probe=ready;source=\(mode);systemSheets=not-observed", timeout: 120)
        DebugUITestConditions.dismissWarningToast(app)
        let scroll = node(app, "unified-import-scroll")
        XCTAssertTrue(scroll.exists && scroll.frame.height > 0, app.debugDescription)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func terminal(_ app: XCUIApplication, id: String, allowed: [String], timeout: TimeInterval) {
        let target = node(app, id)
        let completed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            target.exists && allowed.contains(UITestConditions.text(target))
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [completed], timeout: timeout), .completed, app.debugDescription)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(target.waitForExistence(timeout: 30), app.debugDescription)
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
