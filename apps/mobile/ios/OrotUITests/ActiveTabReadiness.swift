/// A route failure wins even when an unrelated control is already usable.
enum ActiveTabReadiness: Equatable {
    case waiting, ready, routeFailure, fixtureFailure

    static func errorID(for destination: String) -> String? {
        switch destination {
        case "records-layout": "records-recent-sources-error"
        case "overview-screen": "overview-metrics-unavailable"
        case "appointments-scroll": "appointments-retry"
        default: nil
        }
    }

    static func evaluate(routeFailed: Bool, fixtureFailed: Bool, contentReady: Bool) -> Self {
        if routeFailed {
            return .routeFailure
        }
        if fixtureFailed {
            return .fixtureFailure
        }
        return contentReady ? .ready : .waiting
    }
}
