import XCTest

/// Diagnostic-only action and writer evidence is separate from the original form and OS success assertions.
@MainActor
enum ReminderJourneyDiagnostic {
    /// Opt-in is strict: a malformed invocation is infrastructure failure, never ordinary execution.
    static func diagnosticRunID() throws -> String? {
        let environment = ProcessInfo.processInfo.environment
        guard let flag = environment["OROT_IOS_REMINDER_DIAGNOSTICS"] else { return nil }
        guard flag == "YES", let runID = environment["OROT_IOS_REMINDER_DIAGNOSTIC_RUN_ID"],
              UUID(uuidString: runID) != nil else { throw diagnosticError(1) }
        return runID.lowercased()
    }

    static func requireDiagnostic(_ app: XCUIApplication, runID: String, testCase: XCTestCase) throws {
        let marker = UITestConditions.element(app, "reminder-diagnostic-readiness")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let value = try? diagnosticValue(marker) else { return false }
            return value["status"] as? String != nil
        }, object: nil)
        guard UITestConditions.wait(for: [ready]) == .completed else { throw diagnosticError(2) }
        let value = try diagnosticValue(marker)
        attach(value, name: "diagnostic-writer-readiness", testCase: testCase)
        guard value["status"] as? String == "ready", value["runID"] as? String == runID,
              (value["processID"] as? Int ?? 0) > 0, (value["sequence"] as? Int ?? 0) > 0
        else { throw diagnosticError(3) }
    }

    static func actionSequence(_ app: XCUIApplication) throws -> Int {
        let marker = UITestConditions.element(app, "reminder-action-observation")
        let label = try marker.snapshot().label
        if label == "null" {
            return 0
        }
        return try diagnosticValue(marker)["sequence"] as? Int ?? 0
    }

    /// Wait on the selected promise itself; UI error copy cannot establish a settled action.
    static func awaitAction(_ app: XCUIApplication, after sequence: Int, testCase: XCTestCase) throws {
        let marker = UITestConditions.element(app, "reminder-action-observation")
        var terminal: [String: Any]?
        var writerFailed = false
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let health = UITestConditions.element(app, "reminder-diagnostic-readiness")
            if let value = try? diagnosticValue(health), value["status"] as? String != "ready" {
                writerFailed = true
                return true
            }
            guard let value = try? diagnosticValue(marker),
                  value["sequence"] as? Int == sequence + 1,
                  ["resolve", "reject"].contains(value["outcome"] as? String ?? ""),
                  value["currentBusy"] as? Bool == false else { return false }
            terminal = value
            return true
        }, object: nil)
        let result = UITestConditions.wait(for: [settled])
        // Preserve the actual marker and screen before the original success assertions can run.
        let value = try diagnosticValue(marker)
        attach(value, name: "selected-action-terminal", testCase: testCase)
        ReminderJourneyObservation.capture(app, "selected-action-terminal", testCase: testCase)
        if writerFailed {
            try attach(diagnosticValue(UITestConditions.element(app, "reminder-diagnostic-readiness")), name: "diagnostic-writer-failure", testCase: testCase)
        }
        guard !writerFailed, result == .completed, let terminal else { throw diagnosticError(4) }
        try failConfirmedRejection(terminal) {
            XCTFail("The selected reminder action rejected and settled with error; inspect native diagnostic trace")
        }
    }

    /// A confirmed product rejection throws before any original success assertion is reached.
    static func failConfirmedRejection(_ terminal: [String: Any], failure: () -> Void) throws {
        if terminal["outcome"] as? String == "reject", terminal["status"] as? String == "error",
           terminal["busy"] as? Bool == false, terminal["currentBusy"] as? Bool == false,
           terminal["currentStatus"] as? String == "error"
        {
            failure()
            throw NSError(domain: "ReminderDiagnosticProductRejection", code: 1)
        }
    }

    private static func diagnosticValue(_ marker: XCUIElement) throws -> [String: Any] {
        let data = try Data(marker.snapshot().label.utf8)
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw diagnosticError(6) }
        return value
    }

    private static func attach(_ value: [String: Any], name: String, testCase: XCTestCase) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    private static func diagnosticError(_ code: Int) -> NSError {
        NSError(domain: "ReminderDiagnosticInfrastructure", code: code)
    }
}
