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

final class ConversationNativeSceneOwnership {
    var hasVisibleForegroundOwner = false
}

final class ConversationExecutionModule {
    var continuedEpochs: [String: UUID] = [:]
    let nativeOwnership = ConversationNativeSceneOwnership()

    func expireRequest(_ id: String) {
        endLease(id)
        publish(["kind": "expired", "requestId": id])
    }

    var requests: Set<String> = ["current"]
    var continued: [String: Any] = [:]
    var events: [[String: Any]] = []
    func publish(_ event: [String: Any]) {
        events.append(event)
    }

    func endLease(_ id: String) {
        requests.remove(id)
        continuedEpochs.removeValue(forKey: id)
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
        precondition(module.events.last?["state"] as? String == "continued-deferred-inactive")
        UIApplication.shared.applicationState = .inactive
        module.work("current", active: true)
        precondition(module.continued.isEmpty && ConversationContinuedProcessing.starts == 0)
        precondition(module.events.count == 2)
        precondition(module.events.last?["state"] as? String == "continued-deferred-inactive")
        UIApplication.shared.applicationState = .active
        UIApplication.shared.isProtectedDataAvailable = false
        module.work("current", active: true)
        precondition(module.continued.isEmpty && ConversationContinuedProcessing.starts == 0)
        precondition(module.events.count == 2)
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
        module.requests.insert("current")
        module.work("current", active: true)
        let retired = module.continued["current"] as! ConversationContinuedProcessing
        module.work("current", active: false)
        module.work("current", active: true)
        let replacement = module.continued["current"] as! ConversationContinuedProcessing
        retired.expired()
        precondition(module.requests.contains("current") && module.continued["current"] as? ConversationContinuedProcessing === replacement)
        module.nativeOwnership.hasVisibleForegroundOwner = true
        replacement.expired()
        precondition(module.requests.contains("current"))
        module.work("current", active: false)
        module.work("current", active: true)
        let actualBackground = module.continued["current"] as! ConversationContinuedProcessing
        module.nativeOwnership.hasVisibleForegroundOwner = false
        actualBackground.expired()
        precondition(!module.requests.contains("current"))
        precondition(module.events.last?["kind"] as? String == "expired")
        print("PASS continued admission: background, inactive, protected data, foreground, one attempt, decision and ended ownership")
    }
}
