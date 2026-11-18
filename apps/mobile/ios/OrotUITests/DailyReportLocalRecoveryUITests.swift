import XCTest

/// Synthetic protected stores only. Real process restarts, not the settings-consent journey,
/// prove pending publication visibility and explicit local save without a provider surface.
final class DailyReportLocalRecoveryUITests: OrotFailFastTestCase {
    @MainActor
    func testPublishedFinalOutputRestartsAndOnlyExplicitCurrentResumeSaves() {
        let app = XCUIApplication()
        defer { app.terminate() }
        for action in ["resume", "cancel", "delete", "revoke"] {
            let identifier = "test-settings-consent-\(UUID().uuidString.lowercased())"
            launch(app, identifier, "create")
            expect(app, ["\"pendingCount\":1", "\"savedStatus\":\"missing\""])
            app.terminate()
            launch(app, identifier, "reopen")
            expect(app, ["\"pendingCount\":1", "\"savedStatus\":\"missing\""])
            if action != "resume" {
                tap(app, action)
                // Wait for the invalidation to complete before terminating the process.
                expect(app, ["\"invalidated\":\"\(action)\""])
                app.terminate()
                launch(app, identifier, "reopen")
            }
            tap(app, "resume")
            if action == "resume" {
                expect(app, ["\"status\":\"saved\"", "\"savedRevision\":1", "\"pendingCount\":0"])
                tap(app, "resume")
                expect(app, ["\"status\":\"unavailable\"", "\"savedRevision\":1"])
            } else {
                expect(app, ["\"status\":\"unavailable\"", "\"savedStatus\":\"missing\""])
            }
            app.terminate()
            launch(app, identifier, "cleanup")
            XCTAssertTrue(wait { UITestConditions.text(self.status(app)).contains("cleanup-complete") })
            app.terminate()
        }
    }

    @MainActor
    private func launch(_ app: XCUIApplication, _ identifier: String, _ phase: String) {
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "daily-report-visual",
            "-OROT_DAILY_RECOVERY", "synthetic",
            "-OROT_DAILY_RECOVERY_FIXTURE", identifier,
            "-OROT_DAILY_RECOVERY_PHASE", phase,
        ]
        app.launch()
        XCTAssertTrue(UITestConditions.exists(status(app)))
    }

    @MainActor
    private func status(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(identifier: "daily-recovery-native-status").firstMatch
    }

    @MainActor
    private func expect(_ app: XCUIApplication, _ values: [String]) {
        XCTAssertTrue(wait {
            let text = UITestConditions.text(self.status(app))
            return (values + ["\"providerExecution\":\"not-configured\"", "\"authorizationExecution\":\"not-configured\""]).allSatisfy { text.contains($0) }
        })
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ action: String) {
        let button = app.buttons.matching(identifier: "daily-recovery-native-\(action)").firstMatch
        XCTAssertTrue(wait { button.exists && button.isEnabled && button.isHittable })
        button.tap()
    }

    private func wait(_ condition: @escaping () -> Bool) -> Bool {
        let predicate = NSPredicate { _, _ in condition() }
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: nil)], timeout: 20) == .completed
    }
}
