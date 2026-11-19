@main
enum ActiveTabReadinessHostTest {
    static func main() {
        precondition(ActiveTabReadiness.errorID(for: "records-layout") == "records-recent-sources-error")
        precondition(ActiveTabReadiness.errorID(for: "appointments-scroll") == "appointments-retry")
        precondition(ActiveTabReadiness.errorID(for: "overview-screen") == "overview-metrics-unavailable")
        // A failed Overview read must finish the wait even if its edit button is disabled.
        precondition(ActiveTabReadiness.evaluate(routeFailed: true, fixtureFailed: false, contentReady: false) == .routeFailure)
        // A failed Records read must win even when its recording button is visible.
        precondition(ActiveTabReadiness.evaluate(routeFailed: true, fixtureFailed: false, contentReady: true) == .routeFailure)
        // An Appointments retry must terminate a wait even when no list exists.
        precondition(ActiveTabReadiness.evaluate(routeFailed: true, fixtureFailed: false, contentReady: false) == .routeFailure)
        precondition(ActiveTabReadiness.evaluate(routeFailed: false, fixtureFailed: true, contentReady: true) == .fixtureFailure)
        precondition(ActiveTabReadiness.evaluate(routeFailed: false, fixtureFailed: false, contentReady: false) == .waiting)
        precondition(ActiveTabReadiness.evaluate(routeFailed: false, fixtureFailed: false, contentReady: true) == .ready)
        print("PASS: route errors take precedence over visible content")
    }
}
