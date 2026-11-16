import Foundation

/// The production work method is compiled unchanged with these platform doubles.
/// This proves admission bookkeeping, not Apple's scheduling or background runtime.
final class UIApplication {
    enum State { case active, inactive, background }
    static let shared = UIApplication()
    var applicationState = State.active
    var isProtectedDataAvailable = true
}

final class ConversationContinuedProcessing {
    static var starts = 0
    var finishes = 0
    let expired: () -> Void
    init(status _: @escaping (String, Int?) -> Void, expired: @escaping () -> Void) {
        self.expired = expired
    }

    func begin() {
        Self.starts += 1
    }

    func finish(success _: Bool) {
        finishes += 1
    }
}

final class ConversationExecutionModule {
    var requests: Set<String> = ["current"]
    var continued: [String: Any] = [:]
    var events: [[String: Any]] = []
    func publish(_ event: [String: Any]) {
        events.append(event)
    }

    func endLease(_ id: String) {
        requests.remove(id)
        continued.removeValue(forKey: id)
    }
}

@main
enum ConversationContinuedReadmissionHostRegression {
    static func main() {
        let module = ConversationExecutionModule()
        UIApplication.shared.applicationState = .background
        module.work("current", active: true)
        precondition(module.continued.isEmpty && ConversationContinuedProcessing.starts == 0)
        precondition(module.events.last?["state"] as? String == "continued-refused")
        UIApplication.shared.applicationState = .inactive
        module.work("current", active: true)
        precondition(module.continued.isEmpty && ConversationContinuedProcessing.starts == 0)
        UIApplication.shared.applicationState = .active
        UIApplication.shared.isProtectedDataAvailable = false
        module.work("current", active: true)
        precondition(module.continued.isEmpty && ConversationContinuedProcessing.starts == 0)
        UIApplication.shared.isProtectedDataAvailable = true
        module.work("current", active: true)
        precondition(ConversationContinuedProcessing.starts == 1)
        let attempted = module.continued["current"] as! ConversationContinuedProcessing
        // A submitted attempt stays cached whether pending, granted or refused by iOS.
        module.work("current", active: true)
        precondition(ConversationContinuedProcessing.starts == 1)
        precondition(module.continued["current"] as? ConversationContinuedProcessing === attempted)
        module.work("current", active: false)
        precondition(attempted.finishes == 1 && module.continued.isEmpty)
        UIApplication.shared.applicationState = .background
        module.work("current", active: true)
        precondition(ConversationContinuedProcessing.starts == 1 && module.continued.isEmpty)
        module.endLease("current")
        UIApplication.shared.applicationState = .active
        module.work("current", active: true)
        module.work("stale", active: true)
        precondition(ConversationContinuedProcessing.starts == 1 && module.continued.isEmpty)
        print("PASS continued admission: background, inactive, protected data, foreground, one attempt, decision and ended ownership")
    }
}
