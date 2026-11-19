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
}
