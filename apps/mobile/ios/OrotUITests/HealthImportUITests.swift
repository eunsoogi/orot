import XCTest

/// Uses Simulator fixtures only; these journeys do not read personal HealthKit samples.
final class HealthImportUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testDisplayOnlyBloodPressureCompletionCounts() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, scenario: "blood-pressure-visual")

        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        XCTAssertTrue(node(app, "records-new-recording").exists)
        XCTAssertTrue(node(app, "records-open-health-library").exists)
        XCTAssertFalse(node(app, "records-health-import").exists)
        XCTAssertFalse(node(app, "records-open-blood-pressure").exists)

        try openHealthDataSettings(app)
        let bloodPressure = node(app, "health-data-feature-bloodPressure")
        XCTAssertTrue(bloodPressure.exists && bloodPressure.isHittable)
        XCTAssertGreaterThanOrEqual(bloodPressure.frame.height, 44)
        XCTAssertFalse(node(app, "unified-import-start").exists)
        capture(app, "settings-compact-blood-pressure-choice")
    }

    @MainActor
    func testSyntheticBloodPressurePersistsAndReplaysAfterProcessRestart() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, scenario: "blood-pressure")
        try saveAutoSyncSelection(app, features: ["bloodPressure", "medications"])
        try assertCompletedSyncStatus(app)
        try assertBloodPressureLibrary(app)
        capture(app, "blood-pressure-settings-auto-sync")

        // Relaunch checks the saved opt-in refreshes from its cursor without duplicating rows.
        app.terminate()
        launch(app, scenario: "blood-pressure")
        try assertCompletedSyncStatus(app, fromHealthDataSettings: false)
        try assertBloodPressureLibrary(app)
        capture(app, "blood-pressure-library-after-auto-sync-relaunch")
    }

    @MainActor
    func testCommonObservationsUseEncryptedStorageAndIdempotentReplay() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, scenario: "common-observations")
        try saveAutoSyncSelection(app, features: ["heartRate", "steps", "bodyMass"])
        try assertCompletedSyncStatus(app)
        try openHealthLibrary(app)

        tap(app, "health-record-open-detail-heart_rate")
        NavigationUITestConditions.route(app, markers: ["health-records-detail-title"])
        UITestConditions.value(node(app, "health-record-row-0-value"), equals: "72 count/min")
        tap(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["health-records-title"])
        tap(app, "health-record-open-detail-steps")
        NavigationUITestConditions.route(app, markers: ["health-records-detail-title"])
        UITestConditions.value(node(app, "health-record-row-0-value"), equals: "1200 count")
        capture(app, "common-observations-settings-auto-sync")
    }

    @MainActor
    private func launch(_ app: XCUIApplication, scenario: String) {
        app.launchArguments = ["-OROT_TEST_SCENARIO", scenario]
        app.launch()
        UITestConditions.value(node(app, "welcome-title"), equals: "오롯")
        DebugUITestConditions.dismissWarningToast(app)
    }

    @MainActor
    private func openHealthDataSettings(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        tap(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])
    }

    @MainActor
    private func saveAutoSyncSelection(
        _ app: XCUIApplication,
        features: [String],
    ) throws {
        try openHealthDataSettings(app)
        for feature in features {
            tap(app, "health-data-feature-\(feature)")
        }
        tap(app, "health-data-save")
        let saved = node(app, "health-data-status")
        let completed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            saved.exists && UITestConditions.text(saved).contains("자동 동기화 설정을 저장했어요.")
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [completed]), .completed, app.debugDescription)
    }

    @MainActor
    private func assertCompletedSyncStatus(
        _ app: XCUIApplication,
        fromHealthDataSettings: Bool = true,
    ) throws {
        if fromHealthDataSettings {
            tap(app, "navigation-back")
            NavigationUITestConditions.route(app, markers: ["settings-title"])
        } else {
            try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        }
        tap(app, "settings-open-sync-status")
        NavigationUITestConditions.route(app, markers: ["settings-sync-status-title"])
        XCTAssertTrue(node(app, "settings-sync-status-message").exists)
        let message = node(app, "settings-sync-status-message")
        XCTAssertTrue(
            UITestConditions.text(message).contains("마지막 동기화에서 선택한 기록을 확인했어요."),
            app.debugDescription,
        )
        tap(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
    }

    @MainActor
    private func assertBloodPressureLibrary(_ app: XCUIApplication) throws {
        try openHealthLibrary(app)
        let categoryFilter = node(app, "health-record-category-filter")
        let medicationFilter = node(app, "health-record-filter-medications")
        capture(app, "blood-pressure-chart-overview")
        let chart = node(app, "health-record-chart-blood_pressure")
        XCTAssertTrue(chart.exists, app.debugDescription)
        XCTAssertTrue(chart.label.contains("120 mmHg"), chart.label)
        XCTAssertTrue(chart.label.contains("80 mmHg"), chart.label)
        // The accessible image keeps its full summary, while visible card copy stays concise.
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label == %@", chart.label)).firstMatch.exists,
            app.debugDescription,
        )
        tap(app, "health-record-open-detail-blood_pressure")
        NavigationUITestConditions.route(app, markers: ["health-records-detail-title"])
        UITestConditions.value(
            node(app, "health-record-row-0-systolic"),
            equals: "수축기 120 mmHg",
        )
        UITestConditions.value(
            node(app, "health-record-row-0-diastolic"),
            equals: "이완기 80 mmHg",
        )
        XCTAssertTrue(node(app, "health-record-row-0-time").exists)
        tap(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["health-records-title"])
        // Reveal the nested horizontal filter vertically, then scroll it on its own axis.
        FormUITestConditions.reveal(
            categoryFilter,
            in: app,
            scrollID: "health-records-scroll",
            towardTop: true,
        )
        for _ in 0 ..< 8 {
            if categoryFilter.frame.contains(medicationFilter.frame) {
                break
            }
            categoryFilter.swipeLeft()
        }
        XCTAssertTrue(categoryFilter.frame.contains(medicationFilter.frame), app.debugDescription)
        medicationFilter.tap()
        tap(app, "health-record-open-detail-medications")
        NavigationUITestConditions.route(app, markers: ["health-records-detail-title"])
        UITestConditions.value(
            node(app, "health-record-medication-row-0-status"),
            equals: "복용함",
        )
        UITestConditions.value(
            node(app, "health-record-medication-row-0-dose"),
            equals: "1 tablet",
        )
        capture(app, "medication-dose-event-detail")
    }

    @MainActor
    private func openHealthLibrary(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-open-health-library")
        NavigationUITestConditions.route(app, markers: ["health-records-title"])
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        UITestConditions.scrollTo(target, in: app)
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
