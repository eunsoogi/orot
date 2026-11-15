import BackgroundTasks
import UIKit

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
            status("continued-granted", nil)
            continued.expirationHandler = { [weak self] in
                DispatchQueue.main.async {
                    guard let self, !self.finished else { return }
                    self.finish(success: false)
                    self.expired()
                }
            }
            // Three real milestones: checkpoint, received answer, durable saved answer.
            // This is not a duration estimate; there are no timer-based progress heartbeats.
            continued.progress.totalUnitCount = 3
            continued.progress.completedUnitCount = answered ? 2 : 1
            continued.updateTitle("AI 응답 처리", subtitle: answered ? "응답 저장 중" : "응답 기다리는 중")
        }) else { status("continued-refused", nil); return }
        let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: "AI 응답 처리", subtitle: "응답 기다리는 중")
        request.strategy = .fail
        // Default resources are CPU and network. No entitlement or GPU permission is requested.
        do { try BGTaskScheduler.shared.submit(request) }
        catch {
            finished = true
            let code = (error as NSError).code
            status("continued-refused", (1 ... 4).contains(code) ? code : 0)
        } // Keep the existing short lease when admission is denied.
    }

    func receivedAnswer() {
        guard !finished else { return }
        answered = true
        task?.progress.completedUnitCount = 2
        task?.updateTitle("AI 응답 처리", subtitle: "응답 저장 중")
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
