import XCTest

/// Waits for the destination's loaded content or an explicit failure, not just its shell.
@MainActor
enum ActiveTabReadinessUITestConditions {
    enum Failure: Error {
        case unknownDestination, waitInterrupted, routeFailure, fixtureFailure
    }

    static func wait(_ app: XCUIApplication, destination: String) throws {
        let contentID: String
        switch destination {
        case "records-layout":
            contentID = "records-new-recording"
        case "overview-screen":
            contentID = "overview-metrics-edit"
        case "appointments-scroll":
            contentID = "appointments-list"
        default:
            throw Failure.unknownDestination
        }
        let errorID = ActiveTabReadiness.errorID(for: destination)
        let content = UITestConditions.element(app, contentID)
        let destinationElement = UITestConditions.element(app, destination)
        let state = UITestConditions.element(app, "active-tab-workload-state")
        func observation() -> ActiveTabReadiness {
            let routeFailed = errorID.map { UITestConditions.element(app, $0).exists } ?? false
            let fixtureFailed = state.exists && [state.label, state.value as? String ?? ""].contains { ["failed", "unavailable"].contains($0) }
            // The empty marker need not be hittable; it proves Records finished its read.
            let recordsLoaded = destination != "records-layout" || UITestConditions.element(app, "records-recent-sources-empty").exists
            let usable = destinationElement.exists && destinationElement.isHittable && content.exists && content.isHittable &&
                (destination != "overview-screen" || content.isEnabled) && recordsLoaded
            return .evaluate(routeFailed: routeFailed, fixtureFailed: fixtureFailed, contentReady: usable)
        }
        var observed: ActiveTabReadiness = .waiting
        let terminal = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            observed = observation()
            return observed != .waiting
        }, object: nil)
        guard UITestConditions.wait(for: [terminal]) == .completed else { throw Failure.waitInterrupted }
        switch observed {
        case .ready: return
        case .routeFailure: throw Failure.routeFailure
        case .fixtureFailure: throw Failure.fixtureFailure
        case .waiting: throw Failure.waitInterrupted
        }
    }

    /// Reject partial, ambiguous, cancelled, or unrelated reads within the actual UI interval.
    static func overviewReceipt(_ snapshot: [String: Any], run: String, after touch: UInt64, before ready: UInt64, injectedFailure: Bool = false) throws {
        guard let receipt = snapshot["boundaries"] as? [String: Any], receipt["overflow"] as? Bool == false,
              let events = receipt["events"] as? [[String: String]],
              events.allSatisfy({ $0["run"]?.lowercased() == run.lowercased() })
        else { throw Failure.fixtureFailure }
        let indexed = events.compactMap { event -> (String, String, UInt64)? in
            guard let name = event["event"], let operation = event["operation"],
                  let raw = event["tick"], let tick = UInt64(raw) else { return nil }
            return (name, operation, tick)
        }
        guard indexed.count == events.count else { throw Failure.fixtureFailure }
        let candidates = indexed.filter { $0.0 == "overview-read-requested" && $0.2 > touch && $0.2 <= ready }
        guard candidates.count == 1, let request = candidates.first else { throw Failure.fixtureFailure }
        let matching = indexed.filter { $0.1 == request.1 && $0.0.hasPrefix("overview-") }
        let expected = ["overview-read-requested", "overview-direct-requested", "overview-direct-settled", "overview-requested", "overview-admitted"] +
            (injectedFailure ? ["overview-injected-failure", "overview-settled-failed", "overview-load-failed"] : ["overview-settled-ok", "overview-load-ok"])
        guard matching.map(\.0) == expected, let last = matching.last, last.2 <= ready,
              zip(matching, matching.dropFirst()).allSatisfy({ $0.0.2 <= $0.1.2 })
        else { throw Failure.fixtureFailure }
    }
}
