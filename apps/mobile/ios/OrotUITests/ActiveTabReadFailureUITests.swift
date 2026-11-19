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
}
