import BackgroundTasks
import CoreFoundation
import React
import UIKit

/// Opt-in native result stages carry no request IDs, content, model, or error details.
enum ConversationExecutionStage: String {
    case foreground, deferredInactive, submitted, registrationRefused, submissionRefused
    case granted, continuedExpired, shortLeaseDrain, shortLeaseExpired
    case preparationEligible, preparationUnavailable, preparationShortLeaseDenied
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
    private enum Stage: String {
        case checkpointed, toolStarted = "tool_started", toolFinished = "tool_finished"
        case toolCompleted = "tool_completed", toolFailed = "tool_failed", toolCancelled = "tool_cancelled"
        case toolInterrupted = "tool_interrupted", providerWaiting = "provider_waiting"
        case providerFinished = "provider_finished", answered
    }

    // Optional tool work does not estimate duration. A status refresh never advances units.
    private var statusKey = "preparing"
    private var completedUnits: Int64 = 0
    private var activeTools = 0
    private let status: (String, Int?) -> Void
    private let expired: () -> Void

    var active: Bool {
        task != nil && !finished
    }

    #if OROT_TESTS && targetEnvironment(simulator)
        // A submitted or queued task has no witness. Only the real launched BG task does.
        private var fixtureGrantWitness: UUID?
        var activeFixtureGrant: String? {
            active ? fixtureGrantWitness?.uuidString : nil
        }
    #endif

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
            #if OROT_TESTS && targetEnvironment(simulator)
                fixtureGrantWitness = UUID()
            #endif
            continued.expirationHandler = { [weak self] in
                DispatchQueue.main.async {
                    guard let self, !self.finished else { return }
                    observeConversationExecution(.continuedExpired)
                    self.finish(success: false, beforeCompleting: self.expired)
                }
            }
            continued.progress.totalUnitCount = 5
            continued.progress.completedUnitCount = completedUnits
            continued.updateTitle(Self.copy("title"), subtitle: Self.copy(statusKey))
            observeConversationExecution(.granted)
            status("continued-granted", nil)
        }) else {
            observeConversationExecution(.registrationRefused)
            status("continued-refused", nil)
            return
        }
        let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: Self.copy("title"), subtitle: Self.copy("preparing"))
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

    func report(_ code: String) {
        guard !finished, let stage = Stage(rawValue: code), completedUnits < 4 else { return }
        switch stage {
        case .checkpointed:
            guard completedUnits == 0 else { return }
            completedUnits = 1
            statusKey = "waiting"
        case .toolStarted:
            guard activeTools < 16 else { return }
            activeTools += 1
            statusKey = "toolRunning"
        case .toolFinished, .toolCompleted, .toolFailed, .toolCancelled, .toolInterrupted:
            guard activeTools > 0 else { return }
            activeTools -= 1
            if stage == .toolCompleted, (1 ... 2).contains(completedUnits) {
                completedUnits += 1
            }
            statusKey = if activeTools > 0 {
                "toolRunning"
            } else {
                switch stage {
                case .toolFailed: "toolFailed"
                case .toolCancelled: "toolCancelled"
                case .toolInterrupted: "toolInterrupted"
                default: "toolFinished"
                }
            }
        case .providerWaiting:
            statusKey = "modelRunning"
        case .providerFinished:
            statusKey = activeTools > 0 ? "toolRunning" : "waiting"
        case .answered:
            completedUnits = 4
            statusKey = "saving"
        }
        if let task {
            if task.progress.completedUnitCount != completedUnits {
                task.progress.completedUnitCount = completedUnits
            }
            task.updateTitle(Self.copy("title"), subtitle: Self.copy(statusKey))
        }
    }

    func finish(success: Bool, beforeCompleting: () -> Void = {}) {
        guard !finished else { return }
        finished = true
        // Retire the app owner before surrendering the OS task. If retirement
        // re-enters finish, the finished flag leaves completion to this call.
        beforeCompleting()
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        if success {
            task?.progress.completedUnitCount = 5
        }
        task?.setTaskCompleted(success: success)
        task = nil
    }
}

extension ConversationExecutionModule {
    /// Foreground admission is local OS time only. It cannot authorize a send or
    /// create a durable request. The JS owner must either promote or end this ID.
    @objc(beginPreparation:resolver:rejecter:)
    func beginPreparation(_ attempt: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard #available(iOS 26.0, *),
              UIApplication.shared.applicationState == .active,
              UIApplication.shared.isProtectedDataAvailable
        else {
            observeConversationExecution(.preparationUnavailable)
            resolve(false)
            return
        }
        observeConversationExecution(.preparationEligible)
        begin(attempt, resolve: { result in
            guard result as? Bool == true else {
                observeConversationExecution(.preparationShortLeaseDenied)
                resolve(false)
                return
            }
            self.work(attempt, active: true)
            // True is an ordinary execution lease, never proof of a system continued grant.
            resolve(true)
        }, reject: reject)
    }
}

/// Observe a granted task without changing its admission, cancellation, or availability.
func conversationContinuedWorkIsActive(_ work: Any?) -> Bool {
    if #available(iOS 26.0, *) {
        return (work as? ConversationContinuedProcessing)?.active == true
    }
    return false
}

#if OROT_TESTS && targetEnvironment(simulator)
    extension ConversationExecutionModule {
        private func fixtureContinuedGrant(_ requestId: String, token: String) -> String? {
            let settings = UserDefaults.standard
            let app = UIApplication.shared
            guard #available(iOS 26.0, *),
                  settings.string(forKey: "OROT_TEST_SCENARIO") == "conversation-background-retention",
                  settings.string(forKey: "OROT_TEST_BACKGROUND_TOKEN") == token,
                  settings.string(forKey: "OROT_TEST_CONTINUED_GRANT") == "1",
                  UUID(uuidString: token) != nil, app.applicationState == .background,
                  app.isProtectedDataAvailable
            else { return nil }
            return (continuedGrantWithoutShortLease(requestId) as? ConversationContinuedProcessing)?.activeFixtureGrant
        }

        /// A test failure wakes the host without exposing request text or changing production behavior.
        @objc(signalBackgroundFailure:)
        func signalBackgroundFailure(_ token: String) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "conversation-background-retention",
                  UUID(uuidString: token) != nil else { return }
            let name = CFNotificationName("com.orot.tests.conversation-background-failure.\(token)" as CFString)
            CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
        }

        @objc(backgroundContinuedGrant:token:resolver:rejecter:)
        func backgroundContinuedGrant(_ requestId: String, token: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
            if let grant = fixtureContinuedGrant(requestId, token: token) {
                resolve(grant)
            } else {
                resolve(NSNull())
            }
        }

        @objc(signalContinuedBackgroundCommit:token:grant:resolver:rejecter:)
        func signalContinuedBackgroundCommit(_ requestId: String, token: String, grant: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
            guard fixtureContinuedGrant(requestId, token: token) == grant else { resolve(false); return }
            let name = CFNotificationName("com.orot.tests.conversation-background.\(token)" as CFString)
            CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
            resolve(true)
        }
    }
#endif
