import XCTest

extension ActiveTabResponsivenessUITests {
    /// A failed real route reader must reject readiness even with the recording button visible.
    func testRecordsReadFailureDoesNotPassReadiness() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "active-tab-workload",
            "-OROT_WORKLOAD_SESSION", UUID().uuidString,
            "-OROT_PROVIDER_DIAGNOSTICS",
            "-OROT_WORKLOAD_FAIL_ROUTE", "records",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let state = UITestConditions.element(app, "active-tab-workload-state")
        func waitFor(_ expected: String) {
            let outcome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard state.exists else { return false }
                return [state.label, state.value as? String ?? ""].contains { [expected, "failed", "unavailable"].contains($0) }
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [outcome]), .completed)
            XCTAssertTrue(state.label == expected || (state.value as? String) == expected)
        }
        waitFor("ready")
        UITestConditions.element(app, "active-tab-workload-start").tap()
        try NavigationUITestConditions.tapNavigation(app, "navigation-tab-records")
        let routeError = UITestConditions.element(app, "records-recent-sources-error")
        let empty = UITestConditions.element(app, "records-recent-sources-empty")
        let outcome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            routeError.exists || empty.exists || (state.exists && [state.label, state.value as? String ?? ""].contains { ["failed", "unavailable"].contains($0) })
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [outcome]), .completed)
        XCTAssertTrue(routeError.exists)
        XCTAssertTrue(routeError.label.contains("녹음 목록을 불러오지 못했어요."))
        XCTAssertTrue(UITestConditions.element(app, "records-new-recording").isHittable)
        XCTAssertThrowsError(try ActiveTabReadinessUITestConditions.wait(app, destination: "records-layout")) { error in
            XCTAssertEqual(error as? ActiveTabReadinessUITestConditions.Failure, .routeFailure)
        }
        waitFor("finished")
    }

    func testOverviewReadFailureDoesNotPassReadiness() throws {
        let app = XCUIApplication()
        let run = UUID().uuidString
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "active-tab-workload",
            "-OROT_WORKLOAD_SESSION", run,
            "-OROT_PROVIDER_DIAGNOSTICS",
            "-OROT_WORKLOAD_FAIL_ROUTE", "overview",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let state = UITestConditions.element(app, "active-tab-workload-state")
        func waitFor(_ expected: String) {
            let outcome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard state.exists else { return false }
                return [state.label, state.value as? String ?? ""].contains { [expected, "failed", "unavailable"].contains($0) }
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [outcome]), .completed)
            XCTAssertTrue(state.label == expected || (state.value as? String) == expected)
        }
        waitFor("ready")
        UITestConditions.element(app, "active-tab-workload-start").tap()
        try NavigationUITestConditions.tapNavigation(app, "navigation-tab-overview")
        XCTAssertThrowsError(try ActiveTabReadinessUITestConditions.wait(app, destination: "overview-screen")) { error in
            XCTAssertEqual(error as? ActiveTabReadinessUITestConditions.Failure, .routeFailure)
        }
        XCTAssertTrue(UITestConditions.element(app, "overview-metrics-unavailable").exists)
        let marker = UITestConditions.element(app, "active-tab-native-observation")
        let raw = try XCTUnwrap(marker.value as? String)
        let data = try XCTUnwrap(raw.data(using: .utf8))
        let snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let events = try XCTUnwrap(snapshot["events"] as? [[String: Any]])
        let touch = try XCTUnwrap(events.last { $0["target"] as? String == "navigation-tab-overview" && $0["phase"] as? Int == 0 })
        let tick = try XCTUnwrap((touch["tick"] as? NSNumber)?.uint64Value)
        let sampled = try XCTUnwrap((snapshot["sampleTick"] as? NSNumber)?.uint64Value)
        try ActiveTabReadinessUITestConditions.overviewReceipt(snapshot, run: run, after: tick, before: sampled, injectedFailure: true)
        waitFor("finished")
    }
}
