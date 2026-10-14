import XCTest

/// These journeys use the original Simulator fixtures and production UI/storage. They do not prove access to personal HealthKit samples.
final class HealthImportUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testDisplayOnlyBloodPressureCompletionCounts() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        try openBloodPressure(app, scenario: "blood-pressure-visual")
        tap(app, "blood-pressure-import")
        assertCompletion(app, saved: "3개", deleted: "1개", status: "가져오기가 끝났어요")
        capture(app, "blood-pressure-display-only-completion")
    }

    @MainActor
    func testSyntheticBloodPressurePersistsAndReplaysAfterProcessRestart() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        try openBloodPressure(app, scenario: "blood-pressure")
        UITestConditions.value(node(app, "blood-pressure-read-authorization"), equals: "HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.")
        tap(app, "blood-pressure-import")
        assertCompletion(app, saved: "2개", deleted: "0개", status: "가져오기가 끝났어요")
        capture(app, "blood-pressure-synthetic-completion")
        tap(app, "blood-pressure-open-library")
        assertLibrary(app)
        let systolic = UITestConditions.text(node(app, "health-record-row-1-time"))
        let diastolic = UITestConditions.text(node(app, "health-record-row-0-time"))
        XCTAssertNotNil(systolic.range(of: #"^측정 시각: \d{4}-\d\d-\d\dT"#, options: .regularExpression))
        XCTAssertEqual(diastolic, systolic)
        UITestConditions.value(node(app, "blood-pressure-probe-sync"), equals: "status=completed; upserted=2; deleted=0; cursorAdvanced=true")
        capture(app, "blood-pressure-encrypted-library")
        // Termination reopens SQLCipher and the persisted cursor rather than reusing the JS repository instance.
        app.terminate()
        try openBloodPressure(app, scenario: "blood-pressure")
        tap(app, "blood-pressure-import")
        UITestConditions.value(node(app, "blood-pressure-status"), equals: "새로 반영된 기록이 없어요")
        UITestConditions.value(node(app, "blood-pressure-probe-sync"), equals: "status=completed; upserted=0; deleted=0; cursorAdvanced=false")
        capture(app, "blood-pressure-replay-completion")
        tap(app, "blood-pressure-open-library")
        assertLibrary(app)
        UITestConditions.value(node(app, "health-record-row-1-time"), equals: systolic)
        UITestConditions.value(node(app, "health-record-row-0-time"), equals: diastolic)
        capture(app, "blood-pressure-library-after-restart")
    }

    @MainActor
    func testCommonObservationsUseEncryptedStorageAndIdempotentReplay() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "common-observations"]
        app.launch()
        UITestConditions.value(node(app, "welcome-title"), equals: "오롯")
        DebugUITestConditions.dismissWarningToast(app)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-open-common-observations")
        for feature in ["heartRate", "steps", "bodyMass"] {
            tap(app, "common-observations-toggle-\(feature)")
        }
        tap(app, "common-observations-import")
        let summary = node(app, "common-observations-probe-summary")
        let completed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            summary.exists && UITestConditions.text(summary).contains("replayIdempotent=true")
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [completed], timeout: 240), .completed, app.debugDescription)
        XCTAssertTrue(UITestConditions.text(node(app, "common-observations-status")).contains("선택한 기록의 변경을 가져왔어요. 2개 저장, 0개 삭제, 0개 미지원"))
        let value = UITestConditions.text(summary)
        for expected in ["initial=complete:2:0:0:cursor=true", "heartRate=72 count/min", "steps=1200 count", "bodyMass=empty", "readAuthorization=notObservable", "replay=empty:0:0:cursor=false", "records=2", "availability=available", "writeTypes=0", "storage=encrypted-local", "source=synthetic", "replayIdempotent=true"] {
            XCTAssertTrue(value.contains(expected), expected + ": " + value)
        }
        for pattern in [#"initialTiming=authorization_calls:1,authorization_ms:\d+,query_calls:3,query_ms:\d+,storage_transactions:3,storage_ms:\d+"#, #"replayTiming=authorization_calls:1,authorization_ms:\d+,query_calls:3,query_ms:\d+,storage_transactions:0,storage_ms:0"#] {
            XCTAssertNotNil(value.range(of: pattern, options: .regularExpression), value)
        }
        capture(app, "common-observations-encrypted-idempotent-import")
    }

    @MainActor
    private func openBloodPressure(_ app: XCUIApplication, scenario: String) throws {
        app.launchArguments = ["-OROT_TEST_SCENARIO", scenario]
        app.launch()
        UITestConditions.value(node(app, "welcome-title"), equals: "오롯")
        DebugUITestConditions.dismissWarningToast(app)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-open-blood-pressure")
        UITestConditions.value(node(app, "blood-pressure-title"), equals: "혈압 기록")
    }

    @MainActor
    private func assertCompletion(_ app: XCUIApplication, saved: String, deleted: String, status: String) {
        UITestConditions.value(node(app, "blood-pressure-result-saved-count"), equals: saved)
        UITestConditions.value(node(app, "blood-pressure-result-deleted-count"), equals: deleted)
        UITestConditions.value(node(app, "blood-pressure-status"), equals: status)
    }

    @MainActor
    private func assertLibrary(_ app: XCUIApplication) {
        for (id, value) in [("health-records-title", "건강 기록"), ("health-record-row-0-concept", "이완기"), ("health-record-row-0-value", "80 mmHg"), ("health-record-row-1-concept", "수축기"), ("health-record-row-1-value", "120 mmHg"), ("blood-pressure-probe-storage", "sqlCipher=available; rows=2; cursor=fixture-anchor")] {
            UITestConditions.value(node(app, id), equals: value)
        }
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(target.waitForExistence(timeout: 30), app.debugDescription)
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
