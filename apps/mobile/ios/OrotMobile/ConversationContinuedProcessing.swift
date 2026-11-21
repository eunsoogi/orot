import BackgroundTasks
import UIKit

/// Opt-in native result stages carry no request IDs, content, model, or error details.
enum ConversationExecutionStage: String {
    case foreground, deferredInactive, submitted, registrationRefused, submissionRefused
    case granted, continuedExpired, shortLeaseDrain, shortLeaseExpired
}

func observeConversationExecution(_ stage: ConversationExecutionStage) {
    guard ProcessInfo.processInfo.arguments.contains("-OROT_CONVERSATION_EXECUTION_DIAGNOSTICS") else { return }
    NSLog("OROT_CONVERSATION_EXECUTION stage=%@", stage.rawValue)
}

/// A user-submitted answer may continue with CPU/network access, never background GPU.
/// System cancellation, resource pressure and force quit remain terminal; no silent retry.
@available(iOS 26.0, *)
final class ConversationContinuedProcessing {
    private let identifier = "com.orot.mobile.conversation.\(UUID().uuidString)"
    private var task: BGContinuedProcessingTask?
    private var finished = false
    private var answered = false
    private let status: (String, Int?) -> Void
    private let expired: () -> Void

    var active: Bool {
        task != nil && !finished
    }

    init(status: @escaping (String, Int?) -> Void, expired: @escaping () -> Void) {
        self.status = status
        self.expired = expired
    }

    /// Registration is per unique submission; a delayed handler cannot adopt a newer turn.
    func begin() {
        guard UIApplication.shared.applicationState == .active else { status("continued-refused", nil); return }
        guard BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main, launchHandler: { [weak self] task in
            guard let self, !finished, let continued = task as? BGContinuedProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.task = continued
            observeConversationExecution(.granted)
            status("continued-granted", nil)
            continued.expirationHandler = { [weak self] in
                DispatchQueue.main.async {
                    guard let self, !self.finished else { return }
                    observeConversationExecution(.continuedExpired)
                    self.finish(success: false)
                    self.expired()
                }
            }
            // Three real milestones: checkpoint, received answer, durable saved answer.
            // This is not a duration estimate; there are no timer-based progress heartbeats.
            continued.progress.totalUnitCount = 3
            continued.progress.completedUnitCount = answered ? 2 : 1
            continued.updateTitle(Self.copy("title"), subtitle: answered ? Self.copy("saving") : Self.copy("waiting"))
        }) else {
            observeConversationExecution(.registrationRefused)
            status("continued-refused", nil)
            return
        }
        let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: Self.copy("title"), subtitle: Self.copy("waiting"))
        request.strategy = .fail
        // Default resources are CPU and network. No entitlement or GPU permission is requested.
        do {
            try BGTaskScheduler.shared.submit(request)
            observeConversationExecution(.submitted)
        } catch {
            observeConversationExecution(.submissionRefused)
            finished = true
            let code = (error as NSError).code
            status("continued-refused", (1 ... 4).contains(code) ? code : 0)
        } // Keep the existing short lease when admission is denied.
    }

    /// Fixed system progress copy only; no private question or answer is shown here.
    private static func copy(_ key: String) -> String {
        NSLocalizedString(key, tableName: "ConversationProcessingCopy", comment: "Background answer progress")
    }

    func receivedAnswer() {
        guard !finished else { return }
        answered = true
        task?.progress.completedUnitCount = 2
        task?.updateTitle(Self.copy("title"), subtitle: Self.copy("saving"))
    }

    func finish(success: Bool) {
        guard !finished else { return }
        finished = true
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        if success {
            task?.progress.completedUnitCount = 3
        }
        task?.setTaskCompleted(success: success)
        task = nil
    }
}
